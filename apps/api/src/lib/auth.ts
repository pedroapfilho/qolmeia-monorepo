import { envAuthConfig } from "@repo/auth/env-config";
import { createAuth } from "@repo/auth/server";
import { prisma } from "@repo/db";

import { env } from "./env";

const auth = createAuth({
  ...envAuthConfig(),
  fromEmail: env.AUTH_FROM_EMAIL ?? "noreply@qolmeia.ai",
  prisma,
  resendApiKey: env.RESEND_API_KEY,
  secret: env.BETTER_AUTH_SECRET,
});

export { auth };
