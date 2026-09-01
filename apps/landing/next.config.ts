import type { NextConfig } from "next";

import { applyPortlessUrls } from "../../scripts/portless-env.ts";

applyPortlessUrls({
  NEXT_PUBLIC_LANDING_URL: ["qolmeia.landing"],
  NEXT_PUBLIC_WEB_APP_URL: ["qolmeia.web"],
});

const nextConfig: NextConfig = {
  allowedDevOrigins: ["qolmeia.landing.localhost", "*.qolmeia.landing.localhost", "*.vercel.app"],
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

  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
