import type { NextRequest } from "next/server";
import { negotiate } from "@/lib/content-negotiation";

const RIPE_O_PAGES_BASE = "https://ripe-observatory.github.io/RIPE-O/release";
const LATEST_VERSION = "1.0.0";
const SUPPORTED_VERSIONS = new Set([LATEST_VERSION]);

const REPRESENTATIONS = {
  "text/html": { file: "index-en.html" },
  "text/turtle": { file: "ontology.ttl" },
  "application/ld+json": { file: "ontology.jsonld" },
  "application/rdf+xml": { file: "ontology.owl" },
  "application/n-triples": { file: "ontology.nt" },
} as const;

type ResponseFormat = keyof typeof REPRESENTATIONS;

export function redirectToRipeOntology(request: NextRequest, version = LATEST_VERSION): Response {
  if (!SUPPORTED_VERSIONS.has(version)) {
    return new Response("RIPE-O version not found", {
      status: 404,
      headers: commonHeaders(),
    });
  }

  const format = negotiate(request.headers.get("accept"));
  if (!format) {
    return new Response("Not Acceptable", {
      status: 406,
      headers: {
        ...commonHeaders(),
        Accept: Object.keys(REPRESENTATIONS).join(", "),
      },
    });
  }

  return new Response(null, {
    status: 303,
    headers: {
      ...commonHeaders(),
      Location: targetUrl(version, format),
      Link: linkHeader(version),
    },
  });
}

function targetUrl(version: string, format: ResponseFormat): string {
  return `${RIPE_O_PAGES_BASE}/${version}/${REPRESENTATIONS[format].file}`;
}

function linkHeader(version: string): string {
  return Object.keys(REPRESENTATIONS)
    .filter((format) => format !== "text/html")
    .map((format) => `<${targetUrl(version, format as ResponseFormat)}>; rel="alternate"; type="${format}"`)
    .join(", ");
}

function commonHeaders(): HeadersInit {
  return {
    Vary: "Accept",
    "Access-Control-Allow-Origin": "*",
  };
}
