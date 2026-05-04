import "server-only";

import type { NextRequest } from "next/server";
import { localHrefForIri, RIPE_KG_BASE, RIPE_ONTOLOGY_BASE } from "./iri";

const GRAPHDB_URL =
  process.env.SPARQL_ENDPOINT ||
  "http://localhost:7200/repositories/ripe";

const QUERY_TIMEOUT_MS = 30000;

const RDF_FORMATS = [
  "text/turtle",
  "application/ld+json",
  "application/rdf+xml",
  "application/n-triples",
] as const;

type RdfFormat = (typeof RDF_FORMATS)[number];
type ResponseFormat = RdfFormat | "text/html";

interface WeightedMediaType {
  mediaType: string;
  q: number;
  order: number;
}

interface TripleRow {
  subject: string;
  subjectLabel: string;
  predicate: string;
  object: string;
  objectType: string;
  objectLabel: string;
}

export function resourceUriFromSegments(segments: string[]): string {
  return RIPE_KG_BASE + segments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function isSupportedResourceUri(uri: string): boolean {
  if (uri === "https://w3id.org/ripe") return true;
  if (!uri.startsWith(RIPE_ONTOLOGY_BASE) && !uri.startsWith(RIPE_KG_BASE)) return false;
  return /^[^\s<>"{}|\\^`]+$/.test(uri);
}

export async function resolveResource(request: NextRequest, uri: string): Promise<Response> {
  if (!isSupportedResourceUri(uri)) {
    return new Response("Only RIPE resource IRIs are supported.", { status: 400 });
  }

  const format = negotiate(request.headers.get("accept"));
  if (!format) {
    return new Response("Not Acceptable", {
      status: 406,
      headers: {
        Accept: ["text/html", ...RDF_FORMATS].join(", "),
        Vary: "Accept",
      },
    });
  }

  const exists = await resourceExists(uri);
  if (!exists) {
    if (format === "text/html") {
      return new Response(renderHtml(request, uri, []), {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          Link: linkHeader(request),
          Vary: "Accept",
        },
      });
    }
    return new Response("Resource not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Link: linkHeader(request),
        Vary: "Accept",
      },
    });
  }

  return format === "text/html"
    ? htmlResourceResponse(request, uri)
    : rdfResourceResponse(request, uri, format);
}

function negotiate(acceptHeader: string | null): ResponseFormat | null {
  if (!acceptHeader || acceptHeader.trim() === "") {
    return "text/html";
  }

  const accepted = acceptHeader
    .split(",")
    .map((part, order): WeightedMediaType => {
      const [rawMediaType, ...params] = part.trim().split(";").map((item) => item.trim());
      const qParam = params.find((param) => param.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { mediaType: rawMediaType.toLowerCase(), q: Number.isFinite(q) ? q : 1, order };
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

async function rdfResourceResponse(
  request: NextRequest,
  uri: string,
  format: RdfFormat
): Promise<Response> {
  const body = `DESCRIBE <${uri}>`;
  const response = await sparqlRequest(body, format);
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type": `${format}; charset=utf-8`,
      Link: linkHeader(request),
      Vary: "Accept",
    },
  });
}

async function htmlResourceResponse(request: NextRequest, uri: string): Promise<Response> {
  const rows = await fetchResourceTriples(uri);
  return new Response(renderHtml(request, uri, rows), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: linkHeader(request),
      Vary: "Accept",
    },
  });
}

async function resourceExists(uri: string): Promise<boolean> {
  const query = `
ASK {
  { <${uri}> ?predicate ?object }
  UNION
  { ?subject ?predicate <${uri}> }
}`;

  const response = await sparqlRequest(query, "application/sparql-results+json");
  if (!response.ok) {
    throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.boolean === true;
}

async function fetchResourceTriples(uri: string): Promise<TripleRow[]> {
  const query = `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>

SELECT DISTINCT ?subject ?subjectLabel ?predicate ?object ?objectLabel
WHERE {
  {
    BIND(<${uri}> AS ?subject)
    <${uri}> ?predicate ?object .
  }
  UNION
  {
      ?subject ?predicate <${uri}> .
    BIND(<${uri}> AS ?object)
  }
  FILTER(?predicate != owl:sameAs || ?subject != ?object)
  OPTIONAL {
    ?subject (rdfs:label|foaf:name|dcterms:title) ?subjectLabel .
  }
  OPTIONAL {
    ?object (rdfs:label|foaf:name|dcterms:title) ?objectLabel .
  }
}
ORDER BY ?subject ?predicate ?object
LIMIT 500`;

  const response = await sparqlRequest(query, "application/sparql-results+json");
  if (!response.ok) {
    throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return (data.results?.bindings ?? []).map((binding: Record<string, { value: string; type: string }>) => ({
    subject: binding.subject?.value ?? "",
    subjectLabel: binding.subjectLabel?.value ?? "",
    predicate: binding.predicate?.value ?? "",
    object: binding.object?.value ?? "",
    objectType: binding.object?.type ?? "",
    objectLabel: binding.objectLabel?.value ?? "",
  }));
}

async function sparqlRequest(query: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    return await fetch(GRAPHDB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: accept,
      },
      body: query,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
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

function renderHtml(request: NextRequest, uri: string, rows: TripleRow[]): string {
  const title = compactUri(uri);
  const downloadLinks = RDF_FORMATS.map((format) => {
    const href = request.nextUrl.pathname;
    return `<a href="${escapeHtml(href)}" data-format="${format}">${format}</a>`;
  }).join("");

  const rowHtml = rows.map((row) => `
    <tr>
      <td>${renderTerm(row.subject, row.subjectLabel)}</td>
      <td><code>${linkify(row.predicate)}</code></td>
      <td>${renderObject(row)}</td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | RIPE Resource</title>
  <style>
    :root {
      --background: #FAFAF8;
      --surface: #FFFFFF;
      --foreground: #1C1917;
      --muted-foreground: #57534E;
      --border: #E7E5E4;
      --border-strong: #D6D3D1;
      --accent: #D97706;
      --accent-dark: #92400E;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--background);
      background-image: radial-gradient(ellipse at 50% 0%, rgba(217, 119, 6, 0.03) 0%, transparent 60%);
      background-repeat: no-repeat;
      background-size: 100% 800px;
      color: var(--foreground);
      font-family: "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent-dark); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .site-header { position: sticky; top: 0; z-index: 10; background: var(--background); }
    .site-nav { max-width: 1280px; height: 64px; margin: 0 auto; padding: 0 32px; display: flex; align-items: center; justify-content: space-between; }
    .brand { color: #1c1917; font-family: Georgia, "Libre Baskerville", serif; font-size: 18px; text-decoration: none; }
    .brand span { color: #b45309; }
    .nav-links { display: flex; align-items: center; gap: 32px; }
    .nav-links a { color: #57534e; font-size: 14px; font-weight: 600; text-decoration: none; }
    .nav-links a:hover { color: #1c1917; }
    main { max-width: 1480px; margin: 0 auto; padding: 48px 32px 80px; }
    .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .14em; line-height: 1.2; text-transform: uppercase; color: #78716c; }
    h1 { font-family: Georgia, "Libre Baskerville", serif; font-weight: 400; font-size: clamp(30px, 4vw, 48px); line-height: 1.12; margin: 12px 0 10px; max-width: 1100px; }
    .iri { display: block; max-width: 100%; overflow-wrap: anywhere; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted-foreground); background: transparent; border: 0; padding: 0; }
    .formats { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0 32px; }
    .formats a { border: 1px solid var(--border-strong); background: var(--surface); padding: 8px 10px; font-size: 13px; font-weight: 700; line-height: 1; text-decoration: none; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); background: var(--surface); }
    table { width: 100%; min-width: 1180px; border-collapse: collapse; background: var(--surface); }
    th, td { border-bottom: 1px solid var(--border); padding: 12px 14px; text-align: left; vertical-align: top; }
    th { font-size: 12px; font-weight: 700; letter-spacing: .08em; line-height: 1.2; text-transform: uppercase; color: var(--muted-foreground); background: #fafaf9; }
    td:nth-child(1) { width: 30%; }
    td:nth-child(2) { width: 16%; }
    td:nth-child(3) { width: 54%; }
    code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; word-break: break-word; }
    .empty { background: var(--surface); border: 1px solid var(--border); padding: 24px; }
    .label { display: block; color: var(--muted-foreground); margin-top: 4px; font-family: "Source Sans 3", ui-sans-serif, system-ui, sans-serif; font-size: 15px; line-height: 1.35; }
    @media (max-width: 760px) {
      .site-nav { padding: 0 16px; }
      .nav-links { gap: 18px; }
      main { padding: 32px 16px 64px; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="site-nav">
      <a class="brand" href="/explore">RIPE <span>Knowledge Graph</span></a>
      <nav class="nav-links" aria-label="Primary navigation">
        <a href="/explore">Explore</a>
        <a href="/sparql">SPARQL</a>
        <a href="/ontology">Ontology</a>
      </nav>
    </div>
  </header>
  <main>
    <div class="eyebrow">RIPE Resource</div>
    <h1>${escapeHtml(title)}</h1>
    <code class="iri">${escapeHtml(uri)}</code>
    <nav class="formats" aria-label="RDF serializations">${downloadLinks}</nav>
    ${rows.length > 0 ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Subject</th><th>Predicate</th><th>Object</th></tr></thead>
          <tbody>${rowHtml}</tbody>
        </table>
      </div>
    ` : `<div class="empty">No triples were found for this resource in the RIPE repository.</div>`}
  </main>
  <script>
    document.querySelectorAll("[data-format]").forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        const response = await fetch(link.href, { headers: { Accept: link.dataset.format } });
        const text = await response.text();
        const blob = new Blob([text], { type: link.dataset.format });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "resource";
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  </script>
</body>
</html>`;
}

function renderObject(row: TripleRow): string {
  if (row.objectType === "uri") {
    return renderTerm(row.object, row.objectLabel);
  }
  return `<span>${escapeHtml(row.object)}</span>`;
}

function renderTerm(uri: string, label: string): string {
  const labelHtml = label ? `<span class="label">${escapeHtml(label)}</span>` : "";
  return `<code>${linkify(uri)}</code>${labelHtml}`;
}

function linkify(uri: string): string {
  const href = localHrefForIri(uri);
  const label = escapeHtml(compactUri(uri));
  if (href.startsWith("/")) {
    return `<a href="${escapeHtml(href)}">${label}</a>`;
  }
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return `<a href="${escapeHtml(href)}" rel="nofollow noreferrer">${label}</a>`;
  }
  return label;
}

function compactUri(uri: string): string {
  const prefixes: Record<string, string> = {
    [RIPE_ONTOLOGY_BASE]: "ripe:",
    [RIPE_KG_BASE]: "ripekg:",
    "https://w3id.org/tido#": "tido:",
    "http://www.w3.org/ns/prov#": "prov:",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf:",
    "http://www.w3.org/2000/01/rdf-schema#": "rdfs:",
    "http://www.w3.org/2002/07/owl#": "owl:",
    "http://purl.org/dc/terms/": "dcterms:",
    "http://xmlns.com/foaf/0.1/": "foaf:",
    "http://prismstandard.org/namespaces/basic/3.0/": "prism:",
  };
  for (const [base, prefix] of Object.entries(prefixes)) {
    if (uri.startsWith(base)) return prefix + uri.slice(base.length);
  }
  return uri;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
