import type { NextRequest } from "next/server";
import { negotiate, RDF_FORMATS } from "@/lib/content-negotiation";
import { isKgVersion, releasePath, VERSION_HEADER } from "@/lib/versions";

export async function GET(request: NextRequest, context: { params: Promise<{ version: string }> }) {
  const { version } = await context.params;
  if (!isKgVersion(version)) return new Response("Unknown RIPE-KG version", { status: 404 });
  const format = negotiate(request.headers.get("accept"));
  const headers: Record<string, string> = {
    Vary: "Accept",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": VERSION_HEADER,
    [VERSION_HEADER]: version,
    "Cache-Control": "no-store",
    Link: Object.entries(RDF_FORMATS).map(([type, ext]) =>
      `</data/${version}/ripe-data.${ext}>; rel="alternate"; type="${type}"`
    ).join(", "),
  };
  if (!format) return new Response("Not Acceptable", { status: 406, headers });
  headers.Location = format === "text/html"
    ? releasePath(version, "/explore")
    : `/data/${version}/ripe-data.${RDF_FORMATS[format]}`;
  return new Response(null, { status: 303, headers });
}
