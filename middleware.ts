import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // Log all cookie names to Vercel function logs for debugging
  const cookieNames = request.cookies.getAll().map((c) => c.name);
  console.log("[middleware]", pathname, "cookies:", cookieNames.join(", ") || "none");

  let hasSession = false;
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    hasSession = !!session;
    console.log("[middleware] session:", session ? session.user.email : "none");
  } catch (e) {
    // Edge Runtime may not support full auth — fall back to cookie sniff
    console.error("[middleware] getSession error:", e);
    hasSession = cookieNames.some(
      (n) => n.includes("session_token") || n.includes("session-token")
    );
  }

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
