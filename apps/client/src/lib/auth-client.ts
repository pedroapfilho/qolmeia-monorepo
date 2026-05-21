"use client";

import { createBetterAuthClient } from "@repo/auth/client";

// Auth lives at apps/api (/api/auth) — cross-origin. The client app runs
// at :3001 and talks to the API at NEXT_PUBLIC_API_URL (defaulted to
// :4000). Better Auth validates non-empty baseURLs as absolute URLs, so we
// resolve the API origin at module load and append /api/auth.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const authClient = createBetterAuthClient(
  typeof window === "undefined" ? "" : `${apiUrl}/api/auth`,
);
