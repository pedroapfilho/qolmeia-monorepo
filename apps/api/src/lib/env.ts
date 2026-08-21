import { DEFAULT_CORS_ORIGINS } from "@repo/auth/env-config";
import { z } from "zod";

export const envSchema = z.object({
  AUTH_ALLOWED_HOSTS: z.string().optional(),
  AUTH_FROM_EMAIL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default(DEFAULT_CORS_ORIGINS.join(",")),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default("0.0.0.0"),
  // Required, not optional: the agents Worker authenticates every /api/internal/*
  // call with this, and that surface is now the only path it has to Postgres.
  // Booting without it would serve 503s to the entire product (ADR 0010).
  INTERNAL_SHARED_SECRET: z.string().min(32),
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
