import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth";

// Protected: every backoffice route lives behind a session. The dashboard
// "/" is included, plus the operator-facing surfaces that B.3+ will build out.
const protectedRoutes = [
  "/",
  "/agents",
  "/approvals",
  "/activity",
  "/soul",
  "/runs",
  "/team",
  "/settings",
];

// Auth routes redirect away when the user is already signed in.
const authRoutes = ["/login", "/register", "/recover", "/reset-password"];

const matchesRoute = (pathname: string, route: string): boolean => {
  if (route === "/") {
    return pathname === "/";
  }
  return pathname === route || pathname.startsWith(`${route}/`);
};

export const proxy = async (request: NextRequest) => {
  const pathname = request.nextUrl.pathname;

  const isProtectedRoute = protectedRoutes.some((route) => matchesRoute(pathname, route));
  const isAuthRoute = authRoutes.some((route) => matchesRoute(pathname, route));

  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next();
  }

  const session = await getAuth()
    .api.getSession({
      headers: request.headers,
    })
    .catch((error) => {
      // Auth service failure (DB down, misconfiguration, etc.) — log so outages
      // are observable, then treat as unauthenticated to keep the pipeline moving.
      // Role enforcement happens at apps/api (require-staff middleware); the
      // backoffice trusts the cookie + API responses, so this check is intentionally
      // shallow.
      console.error("[proxy] getSession failed — treating as unauthenticated", {
        error,
        pathname,
      });
      return null;
    });

  if (isProtectedRoute && !session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && session) {
    const url = new URL("/", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
};

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|og-image.png|public).*)"],
};
