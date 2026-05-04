import { NextRequest, NextResponse } from "next/server";

const SPARQL_ENDPOINT =
  process.env.SPARQL_ENDPOINT ||
  "http://localhost:7200/repositories/ripe";

// 30 second timeout to avoid long-running queries blocking the server
const QUERY_TIMEOUT_MS = 30000;
const MAX_QUERY_LENGTH = 20000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const ALLOWED_SERVICE_ENDPOINTS = new Set(["https://semopenalex.org/sparql"]);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "local";
}

function rateLimit(request: NextRequest): NextResponse | null {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= RATE_LIMIT_MAX_REQUESTS) return null;

  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
  return NextResponse.json(
    { error: "Rate limit exceeded", details: "Too many SPARQL requests in a short interval" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    }
  );
}

function stripSparqlComments(query: string): string {
  return query
    .split("\n")
    .map((line) => {
      let inIri = false;
      let inSingle = false;
      let inDouble = false;
      let escaped = false;

      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if ((inSingle || inDouble) && char === "\\") {
          escaped = true;
          continue;
        }

        if (!inSingle && !inDouble) {
          if (char === "<") inIri = true;
          if (char === ">") inIri = false;
        }

        if (!inIri && !inDouble && char === "'") inSingle = !inSingle;
        if (!inIri && !inSingle && char === "\"") inDouble = !inDouble;

        if (!inIri && !inSingle && !inDouble && char === "#") {
          return line.slice(0, i);
        }
      }

      return line;
    })
    .join("\n");
}

function stripSparqlStringLiterals(query: string): string {
  return query
    .replace(/"""[\s\S]*?"""/gu, "\"\"")
    .replace(/'''[\s\S]*?'''/gu, "''")
    .replace(/"(?:\\.|[^"\\])*"/gu, "\"\"")
    .replace(/'(?:\\.|[^'\\])*'/gu, "''");
}

function firstQueryKeyword(query: string): string | null {
  const withoutComments = stripSparqlComments(query).trim();
  const withoutDeclarations = withoutComments.replace(
    /^(?:\s*(?:PREFIX\s+\w*:\s*<[^>]+>|BASE\s+<[^>]+>)\s*)+/iu,
    ""
  );
  return withoutDeclarations.match(/^([A-Z]+)/iu)?.[1].toUpperCase() ?? null;
}

function validateReadOnlyQuery(query: string): NextResponse | null {
  if (!query.trim()) {
    return NextResponse.json(
      { error: "Empty SPARQL query", details: "Request body must contain a query" },
      { status: 400 }
    );
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: "SPARQL query too large", details: `Queries are limited to ${MAX_QUERY_LENGTH} characters` },
      { status: 413 }
    );
  }

  const firstKeyword = firstQueryKeyword(query);
  if (!firstKeyword || !["SELECT", "ASK"].includes(firstKeyword)) {
    return NextResponse.json(
      { error: "Unsupported SPARQL operation", details: "Only SELECT and ASK query forms are allowed by this JSON endpoint" },
      { status: 400 }
    );
  }

  const normalized = stripSparqlStringLiterals(stripSparqlComments(query)).toUpperCase();
  const updatePattern = /\b(?:INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|MOVE|COPY|ADD|WITH|USING)\b/u;
  if (updatePattern.test(normalized)) {
    return NextResponse.json(
      { error: "Unsupported SPARQL operation", details: "SPARQL update operations are not allowed" },
      { status: 400 }
    );
  }

  const servicePattern = /\bSERVICE\s+(?:SILENT\s+)?<([^>]+)>/giu;
  for (const match of query.matchAll(servicePattern)) {
    const endpoint = match[1];
    if (!ALLOWED_SERVICE_ENDPOINTS.has(endpoint)) {
      return NextResponse.json(
        { error: "Unsupported SERVICE endpoint", details: `SERVICE endpoint is not allowed: ${endpoint}` },
        { status: 400 }
      );
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const query = await request.text();
    const validationError = validateReadOnlyQuery(query);
    if (validationError) {
      clearTimeout(timeoutId);
      return validationError;
    }

    const response = await fetch(SPARQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
      },
      body: query,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      const reason = response.statusText || `HTTP ${response.status}`;
      return NextResponse.json(
        {
          error: `SPARQL query failed: ${reason}`,
          details: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Query timeout", details: `Query exceeded ${QUERY_TIMEOUT_MS / 1000}s limit` },
        { status: 504 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to execute SPARQL query", details: message },
      { status: 500 }
    );
  }
}
