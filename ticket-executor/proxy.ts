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
  const { pathname } = request.nextUrl;

  // No password configured -> auth disabled (keeps local dev unbroken). The
  // login form is unusable in that state, so send it to the app rather than
  // showing a password field nothing will accept.
  //
  // Cloned from `nextUrl` rather than built with `new URL(path, request.url)`:
  // NextURL re-applies the deployment's basePath on the way out, and the plain
  // URL does not. Under the container's `basePath: "/dagent"` build the plain
  // form emitted `Location: /`, which is a 404 there — so the one redirect that
  // fires when the gate is off sent every stale /dagent/login link to a dead page.
  if (authDisabled()) {
    if (pathname === "/login") {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const authed = await isValidToken(request.cookies.get(AUTH_COOKIE)?.value);
  if (authed) return NextResponse.next();

  // Unauthenticated API calls get a 401; everything else redirects to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cloned from `nextUrl` for the basePath reason described above. This one
  // matters more than it looks: under `basePath: "/dagent"` the plain form sends
  // every unauthenticated page request to `/login`, which is a 404 there — so
  // the login page was unreachable by the one route that is supposed to lead
  // to it.
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on all paths except Next internals and static assets. API routes are
  // intentionally included so they are gated too.
  //
  // `"/"` is listed separately because the pattern below does not match it: Next
  // compiles a matcher through path-to-regexp, where `(...)` is a *parameter*
  // rather than a plain group, and the root has no segment to fill it. Measured,
  // not assumed — with only the pattern, `/settings` and `/projects` redirected
  // to the login page while `/` served the app shell to anyone who asked.
  //
  // It reads like a cosmetic omission and was not: the one page that had to
  // reach the login route was the one page that never did.
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
