import { prisma } from "@repo/db";
import { signJWT } from "better-auth/crypto";

import { authUrl } from "../../../playwright.config";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const requireSecret = (): string => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for verification.fixture (it signs the same JWT Better Auth would).",
    );
  }
  return secret;
};

// Builds the verify-email JWT Better Auth would have signed for `email`.
// Better Auth doesn't persist this token; it's a pure HS256 JWT of
// `{email}` keyed with the auth secret. Reconstructing it lets tests skip
// inbox polling for the seed step (use the Resend helper when delivery
// itself is under test). See node_modules/better-auth/dist/api/routes/
// email-verification.mjs:createEmailVerificationToken.
const forVerifyEmail = async (email: string): Promise<{ token: string; url: string }> => {
  const token = await signJWT({ email: email.toLowerCase() }, requireSecret(), 3600);
  const callbackURL = encodeURIComponent("/");
  const url = `${authUrl}/api/auth/verify-email?token=${token}&callbackURL=${callbackURL}`;
  return { token, url };
};

// Magic-link plugin stores random tokens in the `verification` table.
// `identifier` is the token (plain by default; hashed only if storeToken:
// "hashed" is configured; qolmeia uses the default).
// `value` is `JSON.stringify({email, name})`.
// See node_modules/better-auth/dist/plugins/magic-link/index.mjs.
const forMagicLink = async (
  email: string,
  callbackURL = "/auth/verify",
  timeoutMs = 5000,
): Promise<{ token: string; url: string }> => {
  const target = email.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await prisma.verification.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        expiresAt: { gt: new Date() },
        // Identifier is the token; value contains the email. Filter on the
        // JSON shape Better Auth writes.
        value: { contains: `"email":"${target}"` },
      },
    });

    if (row) {
      const token = row.identifier;
      const url = `${authUrl}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(
        callbackURL,
      )}`;
      return { token, url };
    }

    lastError = `no row yet at ${new Date().toISOString()}`;
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }

  throw new Error(
    `forMagicLink: no magic-link verification row for ${email} within ${timeoutMs}ms (${
      lastError ?? "no attempt logged"
    })`,
  );
};

// Password reset: random token written to the `verification` table with
// `identifier: "reset-password:<token>"`, `value: <userId>`.
const forResetPassword = async (
  email: string,
  timeoutMs = 5000,
): Promise<{ token: string; url: string }> => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user) {
    throw new Error(`forResetPassword: no user with email ${email}`);
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await prisma.verification.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        expiresAt: { gt: new Date() },
        identifier: { startsWith: "reset-password:" },
        value: user.id,
      },
    });

    if (row) {
      const token = row.identifier.replace(/^reset-password:/v, "");
      const url = `${authUrl}/reset-password?token=${token}`;
      return { token, url };
    }

    lastError = `no row yet at ${new Date().toISOString()}`;
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }

  throw new Error(
    `forResetPassword: no reset-password verification for ${email} within ${timeoutMs}ms (${
      lastError ?? "no attempt logged"
    })`,
  );
};

const verification = {
  forMagicLink,
  forResetPassword,
  forVerifyEmail,
};

export { verification };
