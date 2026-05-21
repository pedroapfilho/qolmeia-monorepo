import { createAuth } from "@repo/auth/server";
import { prisma } from "@repo/db";

import { env } from "./env";

// Single Better Auth instance for the api process. Re-exported so route
// handlers, scripts, and tests all share the same config (cookie signing,
// plugin set, rate-limit window). Constructed at module load so config
// errors fail fast on boot rather than mid-request.
const auth = createAuth({
  fromEmail: env.AUTH_FROM_EMAIL ?? "noreply@qolmeia.ai",
  prisma,
  resendApiKey: env.RESEND_API_KEY,
  secret: env.BETTER_AUTH_SECRET,
});

type Auth = typeof auth;

export { auth };
export type { Auth };
