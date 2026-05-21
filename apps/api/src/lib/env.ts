import { z } from "zod";

export const envSchema = z.object({
  AI_GATEWAY_API_KEY: z.string().min(1),
  // Comma-separated extra hosts for Better Auth's dynamic baseURL.
  AUTH_ALLOWED_HOSTS: z.string().optional(),
  // From-address used by transactional email helpers. Defaults to the
  // qolmeia.ai noreply mailbox when unset.
  AUTH_FROM_EMAIL: z.string().optional(),
  // Better Auth cookie/token signing secret. Required everywhere except
  // local CLI scripts that explicitly skip env loading.
  BETTER_AUTH_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z.string().min(1),
  DISPATCH_MODE: z.enum(["serial", "queue"]).default("serial"),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("4000"),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.string().min(1),
  R2_REGION: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Optional — when absent the email-sending hooks become no-ops so dev/CI
  // can run without an external mail provider.
  RESEND_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(1),
  // Comma-separated extra origins for Better Auth's trustedOrigins.
  TRUSTED_ORIGINS: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  // Throwing at module load aborts the process with a stack trace; preferable to
  // process.exit which loses context and conflicts with unicorn/no-process-exit.
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(z.treeifyError(parsedEnv.error), null, 2)}`,
  );
}

export const env = parsedEnv.data;
