import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";

const GRAPHDB_URL =
  process.env.SPARQL_ENDPOINT ||
  "http://localhost:7200/repositories/ripe";

const RDF_FORMATS = [
  "text/turtle",
  "application/ld+json",
  "application/rdf+xml",
  "application/n-triples",
] as const;

type RdfFormat = (typeof RDF_FORMATS)[number];
type ResponseFormat = RdfFormat | "text/html";

export async function GET(request: NextRequest) {
  const format = negotiate(request.headers.get("accept"));
  if (!format || format === "text/html") {
    redirect("/ontology");
  }

  if (format !== "text/turtle") {
    const graphResponse = await graphOntologyResponse(request, format);
    if (graphResponse.ok) return graphResponse;
  }

  const ontologyPath = ontologyTtlPath();
  const body = await readFile(ontologyPath, "utf8");
  return new Response(body, {
    headers: {
      "Content-Type": "text/turtle; charset=utf-8",
      Link: linkHeader(request),
      Vary: "Accept",
    },
  });
}

function ontologyTtlPath(): string {
  if (process.env.RIPE_ONTOLOGY_TTL_PATH) {
    return process.env.RIPE_ONTOLOGY_TTL_PATH;
  }

  const candidates = [
    path.join(process.cwd(), "knowledge", "ripe.ttl"),
    path.join(process.cwd(), "..", "knowledge", "ripe.ttl"),
    path.join(process.cwd(), "..", "..", "knowledge", "ripe.ttl"),
    path.join(process.cwd(), "..", "..", "..", "knowledge", "ripe.ttl"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}

function negotiate(acceptHeader: string | null): ResponseFormat | null {
  if (!acceptHeader || acceptHeader.trim() === "") {
    return "text/html";
  }

  const accepted = acceptHeader
    .split(",")
    .map((part, order) => {
      const [rawMediaType, ...params] = part.trim().split(";").map((item) => item.trim());
      const qParam = params.find((param) => param.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { mediaType: rawMediaType.toLowerCase(), order, q: Number.isFinite(q) ? q : 1 };
    })
    .filter((item) => item.q > 0)
    .sort((left, right) => right.q - left.q || left.order - right.order);

  for (const item of accepted) {
    if (item.mediaType === "text/html" || item.mediaType === "application/xhtml+xml") {
      return "text/html";
    }
    const rdfFormat = RDF_FORMATS.find((candidate) => candidate === item.mediaType);
    if (rdfFormat) return rdfFormat;
    if (item.mediaType === "*/*") return "text/html";
  }
  return null;
}

async function graphOntologyResponse(request: NextRequest, format: RdfFormat): Promise<Response> {
  const query = `
PREFIX owl: <http://www.w3.org/2002/07/owl#>
CONSTRUCT {
  ?subject ?predicate ?object .
}
WHERE {
  ?subject ?predicate ?object .
  FILTER(
    ?subject = <https://w3id.org/ripe/ripe-o> ||
    STRSTARTS(STR(?subject), "https://w3id.org/ripe/ripe-o#")
  )
}`;

  try {
    const response = await fetch(GRAPHDB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: format,
      },
      body: query,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return new Response(null, { status: response.status });
    }

    const body = await response.text();
    return new Response(body, {
      headers: {
        "Content-Type": `${format}; charset=utf-8`,
        Link: linkHeader(request),
        Vary: "Accept",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}

function linkHeader(request: NextRequest): string {
  const resourceUrl = currentResourceUrl(request);
  return RDF_FORMATS
    .map((format) => `<${resourceUrl}>; rel="alternate"; type="${format}"`)
    .join(", ");
}

function currentResourceUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "http";
  return `${proto}://${host}${request.nextUrl.pathname}`;
}
