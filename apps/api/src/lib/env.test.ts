import { describe, expect, it, vi } from "vitest";

// Stub required vars before env.ts module loads so the fail-fast throw is satisfied.
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-minimum-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
vi.stubEnv("R2_ACCESS_KEY_ID", "test-r2-key");
vi.stubEnv("R2_ACCOUNT_ID", "test-account");
vi.stubEnv("R2_BUCKET", "test-bucket");
vi.stubEnv("R2_ENDPOINT", "https://test.r2.cloudflarestorage.com");
vi.stubEnv("R2_REGION", "auto");
vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-r2-secret");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
vi.stubEnv("TELEGRAM_BOT_USERNAME", "qolmeia_bot");
vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "secret");

const { envSchema } = await import("./env");

const base = {
  BETTER_AUTH_SECRET: "test-secret-minimum-32-characters-long",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  OPENROUTER_API_KEY: "test-openrouter-key",
  R2_ACCESS_KEY_ID: "test-r2-key",
  R2_ACCOUNT_ID: "test-account",
  R2_BUCKET: "test-bucket",
  R2_ENDPOINT: "https://test.r2.cloudflarestorage.com",
  R2_REGION: "auto",
  R2_SECRET_ACCESS_KEY: "test-r2-secret",
  REDIS_URL: "redis://localhost:6379",
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_BOT_USERNAME: "qolmeia_bot",
  TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret",
};

describe("envSchema", () => {
  it("parses a valid minimal env with defaults", () => {
    const result = envSchema.parse(base);
    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe("4000");
    expect(result.OPENROUTER_API_KEY).toBe("test-openrouter-key");
  });

  it("defaults IMAGE_GEN_MODEL to google/gemini-3-pro-image-preview (Nano Banana Pro)", () => {
    const result = envSchema.parse(base);
    expect(result.IMAGE_GEN_MODEL).toBe("google/gemini-3-pro-image-preview");
  });

  it("lets IMAGE_GEN_MODEL be overridden via env (hot-swap without redeploy)", () => {
    const result = envSchema.parse({ ...base, IMAGE_GEN_MODEL: "google/gemini-2.5-flash-image" });
    expect(result.IMAGE_GEN_MODEL).toBe("google/gemini-2.5-flash-image");
  });

  it("rejects when OPENROUTER_API_KEY is missing", () => {
    const { OPENROUTER_API_KEY: _key, ...withoutKey } = base;
    expect(() => envSchema.parse(withoutKey)).toThrow();
  });

  it("rejects when a required var is missing", () => {
    const { REDIS_URL: _redisUrl, ...withoutRedis } = base;
    expect(() => envSchema.parse(withoutRedis)).toThrow();
  });
});
