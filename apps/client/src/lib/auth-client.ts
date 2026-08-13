"use client";

import { createBetterAuthClient } from "@repo/auth/client";
import { magicLinkClient, usernameClient } from "better-auth/client/plugins";

const authUrl = process.env.NEXT_PUBLIC_AUTH_URL;

const authClient = createBetterAuthClient({
  baseURL: authUrl !== undefined && authUrl !== "" ? `${authUrl}/api/auth` : "",
  plugins: [usernameClient(), magicLinkClient()],
});

export { authClient };
