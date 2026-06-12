import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth";
import { log } from "@/lib/observability";

// Protected: every backoffice route lives behind a session. The dashboard "/"
// is included plus the operator-facing surfaces. Role check (OWNER/STAFF
// vs CUSTOMER) happens in the dashboard layout via requireStaff.
const protectedRoutes = ["/", "/approvals", "/activity", "/tickets"];

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
      log.error({
        error,
        message: "proxy: getSession failed — treating as unauthenticated",
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
