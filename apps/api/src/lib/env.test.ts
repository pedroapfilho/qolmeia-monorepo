import { describe, expect, it, vi } from "vitest";

vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-minimum-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");

const { envSchema } = await import("./env");

const base = {
  BETTER_AUTH_SECRET: "test-secret-minimum-32-characters-long",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
};

describe("envSchema", () => {
  it("parses a valid minimal env with defaults", () => {
    const result = envSchema.parse(base);
    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe("4000");
    expect(result.AGENTS_INTERNAL_URL).toBe("http://127.0.0.1:8787");
  });

  it("rejects when BETTER_AUTH_SECRET is shorter than 32 chars", () => {
    expect(() => envSchema.parse({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow();
  });

  it("rejects when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _url, ...withoutDb } = base;
    expect(() => envSchema.parse(withoutDb)).toThrow();
  });

  it("accepts an INTERNAL_SHARED_SECRET override for the agents relay", () => {
    const result = envSchema.parse({ ...base, INTERNAL_SHARED_SECRET: "topsecret" });
    expect(result.INTERNAL_SHARED_SECRET).toBe("topsecret");
  });
});
