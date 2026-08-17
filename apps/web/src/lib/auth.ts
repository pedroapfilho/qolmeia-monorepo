import { envAuthConfig } from "@repo/auth/env-config";
import { createAuth } from "@repo/auth/server";
import { prisma } from "@repo/db";
import { nextCookies } from "better-auth/next-js";

type Auth = ReturnType<typeof createAuth>;
let cachedAuth: Auth | undefined;

export const getAuth = (): Auth => {
  if (!cachedAuth) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (secret === undefined || secret.length < 32) {
      throw new Error(
        "BETTER_AUTH_SECRET must be set to at least 32 characters (generate with: openssl rand -base64 32)",
      );
    }
    cachedAuth = createAuth({
      ...envAuthConfig(),
      extraPlugins: [nextCookies()],
      prisma,
      resendApiKey: process.env.RESEND_API_KEY,
      secret,
    });
  }
  return cachedAuth;
};
