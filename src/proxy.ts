import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, isValidSessionToken } from "@/lib/session";

const PUBLIC_PATHS = [/^\/login$/, /^\/pay\//, /^\/api\/invoice\//, /^\/api\/cron\//, /^\/api\/auth\/login$/];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = await isValidSessionToken(token);

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
