import { describe, expect, it, vi } from "vitest";

// Stub required vars before env.ts module loads so the fail-fast throw is satisfied.
vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
vi.stubEnv("TELEGRAM_BOT_USERNAME", "qolmeia_bot");
vi.stubEnv("TELEGRAM_WEBHOOK_SECRET_TOKEN", "secret");

const { envSchema } = await import("./env");

const base = {
  AI_GATEWAY_API_KEY: "test-key",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
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
    expect(result.AI_GATEWAY_API_KEY).toBe("test-key");
  });

  it("rejects when a required var is missing", () => {
    const { REDIS_URL: _redisUrl, ...withoutRedis } = base;
    expect(() => envSchema.parse(withoutRedis)).toThrow();
  });
});
