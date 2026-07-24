"use client";

import { createBetterAuthClient } from "@repo/auth/client";

const authUrl = process.env.NEXT_PUBLIC_AUTH_URL;

export const authClient = createBetterAuthClient(
  authUrl !== undefined && authUrl !== "" ? `${authUrl}/api/auth` : "",
);
