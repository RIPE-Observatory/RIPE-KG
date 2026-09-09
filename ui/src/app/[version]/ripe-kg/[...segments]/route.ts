import type { NextRequest } from "next/server";
import { GET as resource } from "@/app/ripe-kg/[...segments]/route";
import { isKgVersion } from "@/lib/versions";

export async function GET(request: NextRequest, context: { params: Promise<{ version: string; segments: string[] }> }) {
  if (!isKgVersion((await context.params).version)) return new Response("Not found", { status: 404 });
  return resource(request, context);
}
