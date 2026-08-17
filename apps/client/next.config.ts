import type { NextConfig } from "next";

const authServiceUrl = process.env.AUTH_SERVICE_INTERNAL_URL ?? "http://127.0.0.1:4000";

const agentsUrl = process.env.AGENTS_INTERNAL_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["qolmeia.client.localhost", "*.qolmeia.client.localhost", "*.vercel.app"],
  cacheComponents: true,

  experimental: { turbopackRustReactCompiler: true },

  headers: () =>
    Promise.resolve([
      {
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
        source: "/:path*",
      },
    ]),

  partialPrefetching: true,
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

  transpilePackages: ["@repo/app-shell", "@repo/ui", "@repo/worker-api"],
};

export default nextConfig;
