import type { NextRequest } from "next/server";
import { GET as query, OPTIONS as options } from "@/app/api/sparql/route";
import { isKgVersion } from "@/lib/versions";

async function handle(request: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  if (!isKgVersion((await params).version)) {
    return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return request.method === "OPTIONS" ? options() : query(request);
}

export { handle as GET, handle as POST, handle as OPTIONS };
