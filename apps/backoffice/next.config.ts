import type { NextConfig } from "next";

const authServiceUrl = process.env.AUTH_SERVICE_INTERNAL_URL ?? "http://127.0.0.1:4000";

const agentsUrl = process.env.AGENTS_INTERNAL_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "qolmeia.backoffice.localhost",
    "*.qolmeia.backoffice.localhost",
    "*.vercel.app",
  ],
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
        destination: `${agentsUrl}/api/backoffice/:path*`,
        source: "/api/backoffice/:path*",
      },
    ]),

  serverExternalPackages: ["@prisma/client", "@repo/db"],

  transpilePackages: ["@repo/app-shell", "@repo/ui", "@repo/worker-api"],
  turbopack: {
    rules: {
      "*.{ts,tsx}": {
        condition: {
          all: [
            { not: "foreign" },
            // oxlint-disable-next-line eslint/require-unicode-regexp -- Turbopack rejects RegExp flags.
            { content: /[Zz]od/ },
          ],
        },
        loaders: ["zod-compiler/turbopack"],
      },
    },
  },
};

export default nextConfig;
