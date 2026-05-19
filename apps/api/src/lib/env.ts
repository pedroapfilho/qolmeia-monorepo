import { z } from "zod";

export const envSchema = z.object({
  AI_GATEWAY_API_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("4000"),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_REGION: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  REDIS_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(1),
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
