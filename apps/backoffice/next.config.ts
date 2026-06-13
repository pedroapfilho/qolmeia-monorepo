import type { NextConfig } from "next";

// Same-origin auth: browsers treat `.localhost` as a public suffix, so under
// portless dev (qolmeia.backoffice.localhost vs qolmeia.auth.localhost) the
// registrable domains differ and NO shareable cookie domain exists — a
// session cookie set by the auth origin is invisible here. Rewriting
// /api/auth/* to the auth service keeps every browser auth call first-party
// on this app's origin, so the cookie just works, portless or not.
// 127.0.0.1 over `localhost` because Node prefers ::1 for `localhost` and
// the auth service binds IPv4 (same reasoning as playwright.config.ts).
const authServiceUrl = process.env.AUTH_SERVICE_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "qolmeia.backoffice.localhost",
    "*.qolmeia.backoffice.localhost",
    "*.vercel.app",
  ],
  reactStrictMode: true,

  rewrites: () =>
    Promise.resolve([
      {
        destination: `${authServiceUrl}/api/auth/:path*`,
        source: "/api/auth/:path*",
      },
    ]),

  serverExternalPackages: ["@prisma/client", "@repo/db"],

  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
