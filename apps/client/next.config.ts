import type { NextConfig } from "next";

// Same-origin auth: browsers treat `.localhost` as a public suffix, so under
// portless dev (qolmeia.client.localhost vs qolmeia.api.localhost) the
// registrable domains differ and NO shareable cookie domain exists; a
// session cookie set by the auth origin is invisible here. Rewriting
// /api/auth/* to the auth service keeps every browser auth call first-party
// on this app's origin, so the cookie just works, portless or not.
// 127.0.0.1 over `localhost` because Node prefers ::1 for `localhost` and
// the auth service binds IPv4 (same reasoning as playwright.config.ts).
const authServiceUrl = process.env.AUTH_SERVICE_INTERNAL_URL ?? "http://127.0.0.1:4000";

// Same public-suffix problem for the agents Worker: the session cookie set on
// this origin never reaches localhost:8787, so browser calls to the Worker's
// REST surface (/api/me/*, /api/teams/*) are rewritten and stay first-party.
// /agents/* is the chat WebSocket; Next's router-server resolves rewrites
// for upgrade requests and proxies them (proxy.ws), so the socket rides the
// same-origin path too instead of relying on the browser's localhost
// mixed-content exemption (which Safari doesn't implement).
const agentsUrl = process.env.AGENTS_INTERNAL_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["qolmeia.client.localhost", "*.qolmeia.client.localhost", "*.vercel.app"],
  cacheComponents: true,
  reactCompiler: true,
  reactStrictMode: true,

  rewrites: () =>
    Promise.resolve([
      {
        destination: `${authServiceUrl}/api/auth/:path*`,
        source: "/api/auth/:path*",
      },
      {
        destination: `${agentsUrl}/api/me/:path*`,
        source: "/api/me/:path*",
      },
      {
        destination: `${agentsUrl}/api/teams/:path*`,
        source: "/api/teams/:path*",
      },
      {
        destination: `${agentsUrl}/agents/:path*`,
        source: "/agents/:path*",
      },
    ]),

  serverExternalPackages: ["@prisma/client", "@repo/db"],

  transpilePackages: ["@repo/ui", "@repo/worker-api"],
};

export default nextConfig;
