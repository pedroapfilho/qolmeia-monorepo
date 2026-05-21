import { createAuth } from "@repo/auth/server";
import { prisma } from "@repo/db";
import { nextCookies } from "better-auth/next-js";

// Thin auth instance for server-side session validation only (RSC, proxy).
// Auth HTTP routing lives exclusively in the API at /api/auth/*; this
// instance just validates the cookie that the API issued.
type Auth = ReturnType<typeof createAuth>;
let cachedAuth: Auth | undefined;

export const getAuth = (): Auth => {
  if (!cachedAuth) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new Error("BETTER_AUTH_SECRET environment variable is required");
    }
    cachedAuth = createAuth({
      extraPlugins: [nextCookies()],
      prisma,
      resendApiKey: process.env.RESEND_API_KEY,
      secret,
    });
  }
  return cachedAuth;
};
