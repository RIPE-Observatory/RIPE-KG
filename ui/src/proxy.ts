import { NextRequest, NextResponse } from "next/server";
import {
  ASSESSMENT_ID_PATTERN,
  LOCAL_AUTHOR_ID_PATTERN,
  REVIEWER_ID_PATTERN,
} from "@/lib/iri";

import { defaultVersion } from "@/lib/version-endpoints";
import { isKgVersion, legacyReleasePath, PATH_HEADER, releasePath, VERSION_HEADER } from "@/lib/versions";

function notFoundResponse() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

function lastSegment(pathname: string): string {
  try { return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? ""); }
  catch { return ""; }
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const legacyPath = legacyReleasePath(url.pathname);
  if (legacyPath) url.pathname = legacyPath;
  const release = url.pathname.match(/^\/releases\/([^/]+)(\/.*)?$/);
  const requested = url.searchParams.getAll("version");
  if (release && !isKgVersion(release[1])) return notFoundResponse();
  if (requested.length > 1 || (requested.length === 1 && !isKgVersion(requested[0])) ||
      (release && requested.length && requested[0] !== release[1])) {
    return NextResponse.json({ error: "Unknown or conflicting RIPE-KG version" }, {
      status: 400, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  }
  const version = release ? release[1] : requested[0] || defaultVersion();
  if (!isKgVersion(version)) return notFoundResponse();
  if (legacyPath) {
    return NextResponse.redirect(url, {
      status: 307,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-RIPE-KG-Version",
        [VERSION_HEADER]: version,
      },
    });
  }
  const pathname = release ? release[2] || "/" : url.pathname;
  const upstream = new Headers(request.headers);
  upstream.set(VERSION_HEADER, version);
  upstream.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);

  // Compatibility selector for existing API clients; UI URLs become explicit.
  if (requested.length && !release && pathname !== "/api/sparql") {
    url.pathname = releasePath(version, pathname === "/" ? "/explore" : pathname);
    url.searchParams.delete("version");
    return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "no-store" } });
  }
  if (pathname === "/ripe-kg") {
    url.pathname = releasePath(version);
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  }

  if (pathname.startsWith("/assessments/")) {
    if (!ASSESSMENT_ID_PATTERN.test(lastSegment(pathname))) return notFoundResponse();
  }

  if (pathname.startsWith("/reviewers/")) {
    if (!REVIEWER_ID_PATTERN.test(lastSegment(pathname))) return notFoundResponse();
  }

  if (pathname.startsWith("/authors/")) {
    const id = lastSegment(pathname);
    if (!LOCAL_AUTHOR_ID_PATTERN.test(id)) return notFoundResponse();
  }

  const response = NextResponse.next({ request: { headers: upstream } });
  response.headers.set(VERSION_HEADER, version);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|webvowl/|data/|vendor/).*)"],
};
