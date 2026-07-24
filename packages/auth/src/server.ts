import type { PrismaClient } from "@repo/db";
import { log } from "@repo/observability";
import type { MailerConfig } from "@repo/transactional";
import { sendTransactionalEmail } from "@repo/transactional";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins/bearer";
import { magicLink } from "better-auth/plugins/magic-link";
import { username } from "better-auth/plugins/username";
import type { BetterAuthPlugin } from "better-auth/types";

const parseEnvList = (value: string | undefined): Array<string> => {
  if (value === undefined || value === "") {
    return [];
  }
  const result: Array<string> = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      result.push(trimmed);
    }
  }
  return result;
};

const CALLBACK_FALLBACK_PATH = "/";

const CALLBACK_ANCHOR_ORIGIN = "https://qolmeia.invalid";

export const safeCallbackPath = (value: string | null): string => {
  if (value === null || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return CALLBACK_FALLBACK_PATH;
  }
  try {
    if (new URL(value, CALLBACK_ANCHOR_ORIGIN).origin !== CALLBACK_ANCHOR_ORIGIN) {
      return CALLBACK_FALLBACK_PATH;
    }
  } catch {
    return CALLBACK_FALLBACK_PATH;
  }
  return value;
};

type AuthConfig = {
  extraPlugins?: Array<BetterAuthPlugin>;
  fromEmail?: string;
  prisma: PrismaClient;
  resendApiKey?: string;
  secret: string;
};

export const createAuth = (config: AuthConfig) => {
  const {
    extraPlugins = [],
    fromEmail = "noreply@qolmeia.ai",
    prisma,
    resendApiKey,
    secret,
  } = config;

  const cookieDomain = process.env.COOKIE_DOMAIN?.trim();

  const mailer: MailerConfig | null =
    resendApiKey !== undefined && resendApiKey !== ""
      ? { apiKey: resendApiKey, from: fromEmail }
      : null;

  return betterAuth({
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["email"],
      },
    },

    advanced: {
      cookiePrefix: "qolmeia",
      crossSubDomainCookies:
        cookieDomain !== undefined && cookieDomain !== ""
          ? { domain: cookieDomain, enabled: true }
          : undefined,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax" as const,
      },
      useSecureCookies: process.env.WEB_APP_URL?.startsWith("https://") === true,
    },

    basePath: "/api/auth",

    baseURL: {
      allowedHosts: [
        "**.localhost",
        "localhost:*",
        "127.0.0.1:*",
        ...parseEnvList(process.env.AUTH_ALLOWED_HOSTS),
      ],
      fallback: "http://localhost:4000",
      protocol: "auto",
    },

    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),

    emailAndPassword: {
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      onExistingUserSignUp: mailer
        ? async ({ user }, request) => {
            const origin = request?.headers.get("origin") ?? "";
            const result = await sendTransactionalEmail(
              {
                resetPasswordUrl: `${origin}/recover`,
                signInUrl: `${origin}/login`,
                type: "sign-up-attempt",
                userEmail: user.email,
                userId: user.id,
                username: user.name,
              },
              mailer,
            );
            if (!result.success) {
              log.error({
                error: result.error,
                message: "auth: failed to send sign-up attempt email",
              });
            }
          }
        : undefined,
      requireEmailVerification: Boolean(mailer),
      sendResetPassword: async ({ url, user }) => {
        if (!mailer) {
          log.info({
            message: "auth: password-reset link (no Resend key)",
            url,
            userEmail: user.email,
          });
          return;
        }
        const result = await sendTransactionalEmail(
          {
            resetUrl: url,
            type: "password-reset",
            userEmail: user.email,
            userId: user.id,
            username: user.name,
          },
          mailer,
        );
        if (!result.success) {
          throw new Error(`Failed to send password reset email: ${result.error}`);
        }
      },
    },

    emailVerification: {
      autoSignInAfterVerification: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ url, user }, request) => {
        const origin = request?.headers.get("origin");
        const verificationUrl = (() => {
          if (origin === null || origin === "") {
            return url;
          }
          try {
            const target = new URL(url);
            const callbackPath = safeCallbackPath(target.searchParams.get("callbackURL"));
            target.searchParams.set("callbackURL", `${origin}${callbackPath}`);
            return target.toString();
          } catch {
            return url;
          }
        })();
        if (!mailer) {
          log.info({
            message: "auth: verification link (no Resend key)",
            url: verificationUrl,
            userEmail: user.email,
          });
          return;
        }
        const result = await sendTransactionalEmail(
          {
            type: "welcome",
            userEmail: user.email,
            userId: user.id,
            username: user.name,
            verificationUrl,
          },
          mailer,
        );
        if (!result.success) {
          throw new Error(`Failed to send verification email: ${result.error}`);
        }
      },
    },

    plugins: [
      username(),
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          if (!mailer) {
            log.info({ message: "auth: magic-link (no Resend key)", url, userEmail: email });
            return;
          }
          const result = await sendTransactionalEmail(
            {
              type: "magic-link",
              url,
              userEmail: email,
            },
            mailer,
          );
          if (!result.success) {
            throw new Error(`Failed to send magic-link email: ${result.error}`);
          }
        },
      }),
      ...extraPlugins,
    ],

    rateLimit: {
      enabled:
        process.env.NODE_ENV === "production" &&
        (process.env.CI === undefined || process.env.CI === ""),
      max: 100,
      storage: "database",
      window: 60,
    },

    secret,

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      storeSessionInDatabase: true,
      updateAge: 60 * 60 * 24, // Update session if older than 1 day
    },
    trustedOrigins: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:4000",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:4000",
      ...parseEnvList(process.env.TRUSTED_ORIGINS),
    ],
    user: {
      additionalFields: {
        displayName: {
          defaultValue: null,
          required: false,
          type: "string",
        },
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ newEmail, url, user }) => {
          if (!mailer) {
            return;
          }
          const result = await sendTransactionalEmail(
            {
              changeUrl: url,
              currentEmail: user.email,
              newEmail,
              type: "change-email-confirmation",
              userId: user.id,
              username: user.name,
            },
            mailer,
          );
          if (!result.success) {
            throw new Error(`Failed to send change-email confirmation: ${result.error}`);
          }
        },
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
export type { AuthConfig };
