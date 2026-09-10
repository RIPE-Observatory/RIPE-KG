import { NextRequest, NextResponse } from "next/server";
import { defaultVersion, endpointForVersion } from "@/lib/version-endpoints";
import { isKgVersion, VERSION_HEADER } from "@/lib/versions";
import { MAX_QUERY_LENGTH, MAX_RESULT_ROWS, validateQuery } from "@/lib/query-policy";
import { clientRateLimitKey } from "@/lib/client-ip";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Expose-Headers": "X-RIPE-KG-Version, Retry-After, X-RIPE-Result-Limit, X-RIPE-Result-Limit-Reached",
  "Cache-Control": "no-store",
};
const buckets = new Map<string, { count: number; reset: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (bucket && bucket.reset > now) return ++bucket.count > 30;
  if (buckets.size >= 5_000) {
    for (const [id, value] of buckets) if (value.reset <= now) buckets.delete(id);
    if (buckets.size >= 5_000) return true;
  }
  buckets.set(key, { count: 1, reset: now + 60_000 });
  return false;
}

async function queryText(request: NextRequest): Promise<string> {
  if (request.method === "GET" || request.method === "HEAD") {
    const values = request.nextUrl.searchParams.getAll("query");
    if (values.length !== 1) throw new Error("Supply exactly one query parameter");
    return values[0];
  }
  // Bound bytes before decoding; request.text() alone permits unbounded allocation.
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_QUERY_LENGTH * 4) {
        await reader.cancel();
        throw new RangeError("Query body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/x-www-form-urlencoded") {
    const parameters = new URLSearchParams(text);
    if ([...parameters.keys()].some((key) => key !== "query") || parameters.getAll("query").length !== 1) {
      throw new Error("Supply exactly one query form field; dataset selection belongs in the query");
    }
    return parameters.get("query")!;
  }
  return text;
}

async function execute(request: NextRequest) {
  const version = request.headers.get(VERSION_HEADER) || request.nextUrl.searchParams.get("version") || defaultVersion();
  const responseHeaders = { ...CORS, ...(isKgVersion(version) ? { [VERSION_HEADER]: version } : {}) };
  const error = (details: string, status: number, extra = {}) =>
    NextResponse.json({ error: details }, { status, headers: { ...responseHeaders, ...extra } });
  if (!isKgVersion(version)) return error("Unknown RIPE-KG version", 400);
  const clientKey = clientRateLimitKey(request.headers, process.env.RIPE_TRUST_CF_CONNECTING_IP === "true");
  if (clientKey === null) return error("Trusted client address is unavailable", 503);
  if (rateLimited(clientKey)) return error("Too many SPARQL requests", 429, { "Retry-After": "60" });
  if ([...request.nextUrl.searchParams.keys()].some((key) => !["query", "version"].includes(key))) {
    return error("Unsupported query parameter; dataset selection belongs in the query", 400);
  }
  if (request.method === "POST") {
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!["application/sparql-query", "application/x-www-form-urlencoded", "text/plain"].includes(type ?? "")) {
      return error("Use application/sparql-query or application/x-www-form-urlencoded", 415);
    }
  }
  let query: string;
  try {
    query = await queryText(request);
  } catch (failure) {
    return error(failure instanceof Error ? failure.message : "Invalid request body", failure instanceof RangeError ? 413 : 400);
  }
  const invalid = validateQuery(query);
  if (invalid) return error(invalid, query.length > MAX_QUERY_LENGTH ? 413 : 400);
  try {
    const upstream = await fetch(endpointForVersion(version), {
      method: "POST",
      headers: { "Content-Type": "application/sparql-query", Accept: "application/sparql-results+json" },
      body: query,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return error(upstream.status === 400 ? "GraphDB rejected the query" : "Graph query failed", upstream.status === 400 ? 400 : 502);
    }
    // The deadline also covers response-body consumption.
    const data = await upstream.json();
    if (Array.isArray(data.results?.bindings)) {
      // At the cap, GraphDB cannot tell us whether more rows existed. Never
      // present this as a complete result, even for an explicit LIMIT 100000.
      const limitReached = data.results.bindings.length >= MAX_RESULT_ROWS;
      data.metadata = { rowLimit: MAX_RESULT_ROWS, limitReached };
      return NextResponse.json(data, { headers: {
        ...responseHeaders,
        "X-RIPE-Result-Limit": String(MAX_RESULT_ROWS),
        "X-RIPE-Result-Limit-Reached": String(limitReached),
      } });
    }
    return NextResponse.json(data, { headers: responseHeaders });
  } catch (failure) {
    const timeout = failure instanceof Error && ["TimeoutError", "AbortError"].includes(failure.name);
    return error(timeout ? "Query exceeded the 30-second limit" : "Selected version is unavailable", timeout ? 504 : 503);
  }
}

export const GET = execute;
export const POST = execute;
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
