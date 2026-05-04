import { NextRequest, NextResponse } from "next/server";
import {
  ASSESSMENT_ID_PATTERN,
  LOCAL_AUTHOR_ID_PATTERN,
  REVIEWER_ID_PATTERN,
} from "@/lib/iri";

function notFoundResponse() {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function lastSegment(pathname: string): string {
  return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/assessments/:path*", "/authors/:path*", "/reviewers/:path*"],
};
