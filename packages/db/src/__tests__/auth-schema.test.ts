import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../client";

const PREFIX = `auth-${Date.now()}`;
const tag = (key: string): string => `${PREFIX}-${key}`;

describe.skipIf(process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === "")(
  "Auth + OrgMembership schema",
  () => {
    beforeAll(() => {
      expect(prisma.user).toBeDefined();
      expect(prisma.session).toBeDefined();
      expect(prisma.account).toBeDefined();
      expect(prisma.verification).toBeDefined();
      expect(prisma.rateLimit).toBeDefined();
      expect(prisma.orgMembership).toBeDefined();
    });

    afterAll(async () => {
      await prisma.orgMembership.deleteMany({
        where: { user: { email: { startsWith: PREFIX } } },
      });
      await prisma.session.deleteMany({
        where: { user: { email: { startsWith: PREFIX } } },
      });
      await prisma.account.deleteMany({
        where: { user: { email: { startsWith: PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
      await prisma.verification.deleteMany({ where: { identifier: { startsWith: PREFIX } } });
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: PREFIX } } });
      await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    });

    it("round-trips a User with Session, Account, and Verification rows", async () => {
      const email = `${PREFIX}-user1@example.com`;
      const user = await prisma.user.create({
        data: {
          email,
          emailVerified: false,
          name: "Pedro Test",
          username: tag("user1"),
        },
      });
      expect(user.email).toBe(email);
      expect(user.emailVerified).toBe(false);

      const session = await prisma.session.create({
        data: {
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          token: tag("session-token-1"),
          userId: user.id,
        },
      });
      expect(session.userId).toBe(user.id);
      expect(session.impersonatedBy).toBeNull();

      const account = await prisma.account.create({
        data: {
          accountId: email,
          password: "$2b$10$abcdefghijklmnopqrstuv",
          providerId: "credential",
          userId: user.id,
        },
      });
      expect(account.providerId).toBe("credential");
      expect(account.password).toContain("$2b$10$");

      const verification = await prisma.verification.create({
        data: {
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          identifier: `${PREFIX}-magic-link-1`,
          value: "secret-otp-value",
        },
      });
      expect(verification.identifier).toBe(`${PREFIX}-magic-link-1`);

      await prisma.user.delete({ where: { id: user.id } });
      const remainingSession = await prisma.session.findUnique({ where: { id: session.id } });
      const remainingAccount = await prisma.account.findUnique({ where: { id: account.id } });
      expect(remainingSession).toBeNull();
      expect(remainingAccount).toBeNull();
    });

    it("enforces unique email and unique session token", async () => {
      const email = `${PREFIX}-dup@example.com`;
      await prisma.user.create({
        data: { email, name: "Dup User" },
      });
      await expect(
        prisma.user.create({
          data: { email, name: "Other" },
        }),
      ).rejects.toThrow();

      const u = await prisma.user.create({
        data: { email: `${PREFIX}-tok@example.com`, name: "Token User" },
      });
      const token = tag("token-dup");
      await prisma.session.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          token,
          userId: u.id,
        },
      });
      const duplicateExpiresAt = new Date(Date.now() + 60_000);
      await expect(
        prisma.session.create({
          data: {
            expiresAt: duplicateExpiresAt,
            token,
            userId: u.id,
          },
        }),
      ).rejects.toThrow();
    });

    it("round-trips OrgMembership and enforces (userId, orgId) uniqueness", async () => {
      const user = await prisma.user.create({
        data: { email: `${PREFIX}-member@example.com`, name: "Owner User" },
      });
      const org = await prisma.organization.create({
        data: { name: "Member Org", slug: tag("org-member") },
      });

      const membership = await prisma.orgMembership.create({
        data: { orgId: org.id, role: "OWNER", userId: user.id },
      });
      expect(membership.role).toBe("OWNER");

      await expect(
        prisma.orgMembership.create({
          data: { orgId: org.id, role: "STAFF", userId: user.id },
        }),
      ).rejects.toThrow();

      const reloadedUser = await prisma.user.findUnique({
        include: { memberships: { select: { orgId: true, role: true } } },
        where: { id: user.id },
      });
      expect(reloadedUser?.memberships).toEqual([{ orgId: org.id, role: "OWNER" }]);

      const reloadedOrg = await prisma.organization.findUnique({
        include: { memberships: { select: { role: true, userId: true } } },
        where: { id: org.id },
      });
      expect(reloadedOrg?.memberships).toEqual([{ role: "OWNER", userId: user.id }]);

      await prisma.organization.delete({ where: { id: org.id } });
      const remaining = await prisma.orgMembership.findMany({
        where: { id: membership.id },
      });
      expect(remaining).toEqual([]);
    });
  },
);
