import { z } from "zod";

// Auth-only env schema. After the P7.2 cutover, this service does identity
// + membership only. The legacy product env vars (Redis, Telegram, R2,
// OpenRouter, etc.) live on apps/agents.

export const envSchema = z.object({
  AUTH_ALLOWED_HOSTS: z.string().optional(),
  AUTH_FROM_EMAIL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default("0.0.0.0"),
  // Shared secret between apps/api → apps/agents for the org-create relay.
  // Defaults to empty in dev (the receiver will reject if mismatched).
  INTERNAL_SHARED_SECRET: z.string().optional(),
  // URL where the agents Worker lives — used by the org-create relay.
  AGENTS_INTERNAL_URL: z.string().default("http://localhost:8787"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("4000"),
  RESEND_API_KEY: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  WEB_APP_URL: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(z.treeifyError(parsedEnv.error), null, 2)}`,
  );
}

export const env = parsedEnv.data;
