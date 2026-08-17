import { afterEach, describe, expect, it, vi } from "vitest";

import { envAuthConfig, parseEnvList } from "./env-config";

describe("parseEnvList", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns an empty list for undefined or empty input", () => {
    expect(parseEnvList(undefined)).toEqual([]);
    expect(parseEnvList("")).toEqual([]);
  });

  it("splits on commas and trims each entry", () => {
    expect(parseEnvList(" a.com , b.com ")).toEqual(["a.com", "b.com"]);
  });

  it("drops empty entries", () => {
    expect(parseEnvList("a.com,,b.com,")).toEqual(["a.com", "b.com"]);
  });
});

describe("envAuthConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes the localhost host patterns and loopback origins by default", () => {
    const config = envAuthConfig();
    expect(config.allowedHosts).toEqual(
      expect.arrayContaining(["**.localhost", "localhost:*", "127.0.0.1:*"]),
    );
    expect(config.trustedOrigins).toContain("http://localhost:3000");
    expect(config.trustedOrigins).toContain("http://127.0.0.1:3000");
  });

  it("extends allowedHosts from AUTH_ALLOWED_HOSTS", () => {
    vi.stubEnv("AUTH_ALLOWED_HOSTS", "qolmeia.com,*.qolmeia.com,*.vercel.app");
    expect(envAuthConfig().allowedHosts).toEqual(
      expect.arrayContaining(["qolmeia.com", "*.qolmeia.com", "*.vercel.app"]),
    );
  });

  it("extends trustedOrigins from TRUSTED_ORIGINS", () => {
    vi.stubEnv("TRUSTED_ORIGINS", "https://app.qolmeia.com,https://api.qolmeia.com");
    const { trustedOrigins } = envAuthConfig();
    expect(trustedOrigins).toContain("https://app.qolmeia.com");
    expect(trustedOrigins).toContain("https://api.qolmeia.com");
    expect(trustedOrigins).toContain("http://localhost:3000");
  });

  it("trusts the origins allowed to send credentialed Hono requests", () => {
    vi.stubEnv("CORS_ORIGINS", "https://client.qolmeia.com, https://backoffice.qolmeia.com");
    expect(envAuthConfig().trustedOrigins).toEqual(
      expect.arrayContaining(["https://client.qolmeia.com", "https://backoffice.qolmeia.com"]),
    );
  });

  it("does not trust the non-credentialed CORS wildcard", () => {
    vi.stubEnv("CORS_ORIGINS", "*");
    expect(envAuthConfig().trustedOrigins).not.toContain("*");
  });

  it("omits cookieDomain unless COOKIE_DOMAIN is set", () => {
    expect(envAuthConfig().cookieDomain).toBeUndefined();
    vi.stubEnv("COOKIE_DOMAIN", " .qolmeia.com ");
    expect(envAuthConfig().cookieDomain).toBe(".qolmeia.com");
  });

  it("gates useSecureCookies on WEB_APP_URL being HTTPS", () => {
    vi.stubEnv("WEB_APP_URL", "http://localhost:3000");
    expect(envAuthConfig().useSecureCookies).toBe(false);
    vi.stubEnv("WEB_APP_URL", "https://qolmeia.web.localhost");
    expect(envAuthConfig().useSecureCookies).toBe(true);
  });

  it("enables rate limiting only in production outside CI", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", "");
    expect(envAuthConfig().rateLimitEnabled).toBe(true);
    vi.stubEnv("CI", "true");
    expect(envAuthConfig().rateLimitEnabled).toBe(false);
  });
});
