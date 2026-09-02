import { applyPortlessUrls } from "@repo/portless-env";
import type { NextConfig } from "next";

applyPortlessUrls({
  AGENTS_INTERNAL_URL: ["qolmeia.agents"],
  AUTH_SERVICE_INTERNAL_URL: ["qolmeia.api"],
  WEB_APP_URL: ["qolmeia.web"],
});

const authServiceUrl = process.env.AUTH_SERVICE_INTERNAL_URL ?? "http://127.0.0.1:4000";

const agentsUrl = process.env.AGENTS_INTERNAL_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["qolmeia.web.localhost", "*.qolmeia.web.localhost", "*.vercel.app"],
  cacheComponents: true,

  experimental: {
    exposeTestingApiInProductionBuild: process.env.EXPOSE_TESTING_API === "1",
    instantInsights: { validationLevel: "manual-warning" },
    turbopackRustReactCompiler: true,
  },

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
