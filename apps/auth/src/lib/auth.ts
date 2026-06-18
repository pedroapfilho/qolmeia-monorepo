import { createAuth } from "@repo/auth/server";
import { db } from "@repo/db";

import { env } from "./env";

// Single Better Auth instance for the api process. Re-exported so route
// handlers, scripts, and tests all share the same config (cookie signing,
// plugin set, rate-limit window). Constructed at module load so config
// errors fail fast on boot rather than mid-request.
const auth = createAuth({
  fromEmail: env.AUTH_FROM_EMAIL ?? "noreply@qolmeia.ai",
  db,
  resendApiKey: env.RESEND_API_KEY,
  secret: env.BETTER_AUTH_SECRET,
});

export { auth };
