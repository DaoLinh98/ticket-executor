import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authDisabled, isValidToken } from "@/lib/auth";

// Auth gate (Next 16 renamed Middleware -> Proxy). Runs on every request the
// matcher below lets through: unauthenticated page requests redirect to /login,
// unauthenticated /api/* requests get a 401. The login/logout endpoints and the
// login page itself are always allowed so the gate can be passed.

// Paths reachable without a session.
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
]);

export async function proxy(request: NextRequest) {
  // No password configured -> auth disabled (keeps local dev unbroken).
  if (authDisabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const authed = await isValidToken(request.cookies.get(AUTH_COOKIE)?.value);
  if (authed) return NextResponse.next();

  // Unauthenticated API calls get a 401; everything else redirects to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on all paths except Next internals and static assets. API routes are
  // intentionally included so they are gated too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
