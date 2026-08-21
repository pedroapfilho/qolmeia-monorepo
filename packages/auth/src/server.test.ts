import { prisma } from "@repo/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createAuth, safeCallbackPath } from "./server";
import type { AuthConfig } from "./server";

type Plugin = NonNullable<AuthConfig["extraPlugins"]>[number];

const baseConfig = {
  allowedHosts: ["**.localhost", "localhost:*", "127.0.0.1:*"],
  prisma,
  secret: "test-secret-minimum-32-characters-long",
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:4000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:4000",
  ],
} satisfies AuthConfig;

describe("Auth Server Configuration", () => {
  let auth: ReturnType<typeof createAuth>;

  beforeAll(() => {
    auth = createAuth(baseConfig);
  });

  it("should have email and password authentication enabled", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
  });

  it("should require 12 character minimum password", () => {
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(12);
  });

  it("should have maximum password length of 128", () => {
    expect(auth.options.emailAndPassword?.maxPasswordLength).toBe(128);
  });

  it("should have cookie cache enabled", () => {
    expect(auth.options.session?.cookieCache?.enabled).toBe(true);
  });

  it("should have 5 minute cookie cache max age", () => {
    expect(auth.options.session?.cookieCache?.maxAge).toBe(5 * 60);
  });

  it("should use qolmeia cookie prefix", () => {
    expect(auth.options.advanced?.cookiePrefix).toBe("qolmeia");
  });

  it("should default useSecureCookies to false", () => {
    expect(auth.options.advanced?.useSecureCookies).toBe(false);
    expect(auth.options.advanced?.defaultCookieAttributes?.httpOnly).toBe(true);
    expect(auth.options.advanced?.defaultCookieAttributes?.sameSite).toBe("lax");
  });

  it("should set useSecureCookies when the caller asks for it", () => {
    const httpsAuth = createAuth({ ...baseConfig, useSecureCookies: true });
    expect(httpsAuth.options.advanced?.useSecureCookies).toBe(true);
  });

  it("keeps cookies host-only so each app has an independent session", () => {
    expect(Object.hasOwn(auth.options.advanced ?? {}, "crossSubDomainCookies")).toBe(false);
    expect(Object.hasOwn(auth.options.advanced?.defaultCookieAttributes ?? {}, "domain")).toBe(
      false,
    );
  });

  it("should configure dynamic baseURL with allowedHosts + protocol auto", () => {
    const baseURL = auth.options.baseURL;
    if (typeof baseURL !== "object" || baseURL === null) {
      throw new Error("expected dynamic baseURL object");
    }
    expect(baseURL.protocol).toBe("auto");
    expect(baseURL.allowedHosts).toEqual(
      expect.arrayContaining(["**.localhost", "localhost:*", "127.0.0.1:*"]),
    );
    expect(baseURL.fallback).toBe("http://localhost:4000");
  });

  it("should pass caller-provided allowedHosts through to baseURL", () => {
    const envAuth = createAuth({
      ...baseConfig,
      allowedHosts: [...baseConfig.allowedHosts, "qolmeia.com", "*.qolmeia.com", "*.vercel.app"],
    });
    const baseURL = envAuth.options.baseURL;
    if (typeof baseURL !== "object" || baseURL === null) {
      throw new Error("expected dynamic baseURL object");
    }
    expect(baseURL.allowedHosts).toEqual(
      expect.arrayContaining(["qolmeia.com", "*.qolmeia.com", "*.vercel.app"]),
    );
  });

  it("should require email verification when Resend is configured", () => {
    const verifyingAuth = createAuth({ ...baseConfig, resendApiKey: "re_test_key" });
    expect(verifyingAuth.options.emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("should NOT require email verification when Resend is absent", () => {
    const noResendAuth = createAuth(baseConfig);
    expect(noResendAuth.options.emailAndPassword?.requireEmailVerification).toBe(false);
  });

  it("should have bearer token plugin enabled", () => {
    const plugins = auth.options.plugins;
    const hasBearerToken = plugins.some((plugin) => plugin.id === "bearer");
    expect(hasBearerToken).toBe(true);
  });

  it("should have username plugin enabled", () => {
    const plugins = auth.options.plugins;
    const hasUsername = plugins.some((plugin) => plugin.id === "username");
    expect(hasUsername).toBe(true);
  });

  it("should have magic-link plugin enabled", () => {
    const plugins = auth.options.plugins;
    const hasMagicLink = plugins.some((plugin) => plugin.id === "magic-link");
    expect(hasMagicLink).toBe(true);
  });

  it("should have account linking enabled", () => {
    expect(auth.options.account?.accountLinking?.enabled).toBe(true);
  });

  it("should trust host by default", () => {
    expect(auth.options.trustedOrigins).toContain("http://localhost:3000");
  });

  it("should use database storage for rate limiting", () => {
    expect(auth.options.rateLimit?.storage).toBe("database");
  });

  it("should have correct rate-limiting window and max", () => {
    expect(auth.options.rateLimit?.window).toBe(60);
    expect(auth.options.rateLimit?.max).toBe(100);
  });

  it("should default rate limiting to off and enable it when the caller asks", () => {
    expect(auth.options.rateLimit?.enabled).toBe(false);
    const prodAuth = createAuth({ ...baseConfig, rateLimitEnabled: true });
    expect(prodAuth.options.rateLimit?.enabled).toBe(true);
  });

  it("should pass caller-provided trustedOrigins through", () => {
    const envAuth = createAuth({
      ...baseConfig,
      trustedOrigins: [
        ...baseConfig.trustedOrigins,
        "https://app.qolmeia.com",
        "https://api.qolmeia.com",
      ],
    });
    const trusted = envAuth.options.trustedOrigins;
    expect(trusted).toContain("https://app.qolmeia.com");
    expect(trusted).toContain("https://api.qolmeia.com");
    expect(trusted).toContain("http://localhost:3000");
    expect(trusted).toContain("http://127.0.0.1:3000");
  });

  it("should always define reset password handler (no-op when resendApiKey is absent)", () => {
    expect(auth.options.emailAndPassword?.sendResetPassword).toBeDefined();
  });

  it("should configure reset password email when resendApiKey is provided", () => {
    const emailAuth = createAuth({ ...baseConfig, resendApiKey: "re_test_key" });
    expect(emailAuth.options.emailAndPassword?.sendResetPassword).toBeDefined();
  });

  it("should expire sessions after 7 days", () => {
    expect(auth.options.session?.expiresIn).toBe(60 * 60 * 24 * 7);
  });

  it("should refresh sessions that are older than 1 day", () => {
    expect(auth.options.session?.updateAge).toBe(60 * 60 * 24);
  });

  it("should include extra plugins in the resolved plugin list", () => {
    const mockPlugin = { id: "test-plugin", init: () => ({}) } as unknown as Plugin;
    const extendedAuth = createAuth({ ...baseConfig, extraPlugins: [mockPlugin] });
    const plugins = extendedAuth.options.plugins ?? [];
    expect(plugins.some((p) => p.id === "test-plugin")).toBe(true);
  });

  it("should always define verification email handler (no-op when resendApiKey is absent)", () => {
    expect(auth.options.emailVerification?.sendVerificationEmail).toBeDefined();
  });

  it("should configure verification email when resendApiKey is provided", () => {
    const emailAuth = createAuth({ ...baseConfig, resendApiKey: "re_test_key" });
    expect(emailAuth.options.emailVerification?.sendVerificationEmail).toBeDefined();
  });

  it("enables autoSignInAfterVerification so the verification link is the login", () => {
    expect(auth.options.emailVerification?.autoSignInAfterVerification).toBe(true);
  });

  it("re-sends the verification email on unverified sign-in attempts", () => {
    expect(auth.options.emailVerification?.sendOnSignIn).toBe(true);
  });

  it("preserves a caller-provided in-app callbackURL path", () => {
    expect(safeCallbackPath("/tickets")).toBe("/tickets");
    expect(safeCallbackPath("/tickets?status=open#top")).toBe("/tickets?status=open#top");
    expect(safeCallbackPath("/")).toBe("/");
  });

  it("defaults absent or empty callbackURL to the app root", () => {
    expect(safeCallbackPath(null)).toBe("/");
    expect(safeCallbackPath("")).toBe("/");
  });

  it("rejects open-redirect callbackURL values", () => {
    expect(safeCallbackPath("//evil.com")).toBe("/");
    expect(safeCallbackPath("//evil.com/phish")).toBe("/");
    expect(safeCallbackPath(String.raw`/\evil.com`)).toBe("/");
    expect(safeCallbackPath(String.raw`\/evil.com`)).toBe("/");
    expect(safeCallbackPath("https://evil.com/phish")).toBe("/");
    expect(safeCallbackPath(["javascript", "alert(1)"].join(":"))).toBe("/");
    expect(safeCallbackPath("evil.com")).toBe("/");
  });

  it("should have displayName as optional additional user field", () => {
    const displayName = auth.options.user?.additionalFields?.displayName;
    expect(displayName).toEqual({
      defaultValue: null,
      required: false,
      type: "string",
    });
  });
});
