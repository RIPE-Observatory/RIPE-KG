import { GET as health } from "@/app/api/health/route";
import { isKgVersion } from "@/lib/versions";

export async function GET(_request: Request, { params }: { params: Promise<{ version: string }> }) {
  if (!isKgVersion((await params).version)) return new Response("Not found", { status: 404 });
  return health();
}
