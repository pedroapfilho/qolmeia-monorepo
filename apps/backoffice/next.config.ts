import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_API_URL: apiUrl },
  reactStrictMode: true,

  serverExternalPackages: ["@prisma/client", "@repo/db"],

  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
