"use client";

import { createBetterAuthClient } from "@repo/auth/client";

// Auth lives at apps/auth (/api/auth) — cross-origin. The client app runs
// at :3001 and talks to the auth service at NEXT_PUBLIC_AUTH_URL (defaulted
// to :4000). Better Auth validates non-empty baseURLs as absolute URLs, so
// we resolve the auth origin at module load and append /api/auth.
const authUrl =
  process.env.NEXT_PUBLIC_AUTH_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const authClient = createBetterAuthClient(
  typeof window === "undefined" ? "" : `${authUrl}/api/auth`,
);
