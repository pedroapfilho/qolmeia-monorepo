import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuth } from "@/lib/auth";

// Protected: every client route lives behind a session. The chat home
// "/" plus assets/activity make up the customer surface.
const protectedRoutes = ["/", "/assets", "/activity", "/no-access"];

// Auth routes redirect away when the user is already signed in.
const authRoutes = ["/login", "/auth/verify"];

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

  // /auth/verify is the magic-link landing — handle as auth-route (no
  // session required to reach it, since the click flow exchanges a token
  // *for* a session).
  if (pathname.startsWith("/auth/verify")) {
    return NextResponse.next();
  }

  const session = await getAuth()
    .api.getSession({
      headers: request.headers,
    })
    .catch((error) => {
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
