import type { NextRequest } from "next/server";
import { resolveResource, resourceUriFromSegments } from "@/lib/resource-resolver";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  const { segments } = await context.params;
  return resolveResource(request, resourceUriFromSegments(segments));
}
