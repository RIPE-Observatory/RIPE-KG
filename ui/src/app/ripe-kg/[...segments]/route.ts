import type { NextRequest } from "next/server";
import { resolveResource, resourceUriFromSegments } from "@/lib/resource-resolver";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  const { segments } = await context.params;
  try {
    const response = await resolveResource(request, resourceUriFromSegments(segments));
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Expose-Headers", "X-RIPE-KG-Version");
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return new Response(timeout ? "Resource query timed out" : "Selected version is unavailable", {
      status: timeout ? 504 : 503,
      headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    });
  }
}
