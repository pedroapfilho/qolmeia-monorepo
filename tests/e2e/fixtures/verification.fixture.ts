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

const forVerifyEmail = async (email: string): Promise<{ token: string; url: string }> => {
  const token = await signJWT({ email: email.toLowerCase() }, requireSecret(), 3600);
  const callbackURL = encodeURIComponent("/");
  const url = `${authUrl}/api/auth/verify-email?token=${token}&callbackURL=${callbackURL}`;
  return { token, url };
};

const forMagicLink = async (
  email: string,
  callbackURL = "/auth/verify",
  timeoutMs = 5000,
): Promise<{ token: string; url: string }> => {
  const target = email.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    const row = await prisma.verification.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        expiresAt: { gt: new Date() },
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
    await sleep(100);
  }

  throw new Error(
    `forMagicLink: no magic-link verification row for ${email} within ${timeoutMs}ms (${
      lastError ?? "no attempt logged"
    })`,
  );
};

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
    const row = await prisma.verification.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        expiresAt: { gt: new Date() },
        identifier: { startsWith: "reset-password:" },
        value: user.id,
      },
    });

    if (row) {
      const token = row.identifier.replace(/^reset-password:/u, "");
      const url = `${authUrl}/reset-password?token=${token}`;
      return { token, url };
    }

    lastError = `no row yet at ${new Date().toISOString()}`;
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
