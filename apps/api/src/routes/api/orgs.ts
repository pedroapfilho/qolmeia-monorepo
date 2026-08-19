import type { PrismaClient } from "@repo/db";
import { Prisma, prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";
import { z } from "zod";

import { provisionCompany } from "@/data/agents/companies";
import { jsonError, unauthorized } from "@/lib/api-response";
import { auth as defaultAuth } from "@/lib/auth";

type OrgsPrisma = Pick<PrismaClient, "$transaction">;

type AuthLike = {
  api: {
    getSession: (args: { headers: Headers }) => Promise<{
      session: { id: string; userId: string };
      user: { email: string; id: string; name: string };
    } | null>;
  };
};

type OrgsRouteDeps = {
  auth?: AuthLike;
  prisma?: OrgsPrisma;
  provision?: (
    prisma: Prisma.TransactionClient,
    input: { id: string; name: string; slug: string },
  ) => Promise<{ ok: true }>;
};

const SLUG_CHARS = new Set("abcdefghijklmnopqrstuvwxyz0123456789-");

const isValidSlug = (slug: string): boolean => {
  if (slug.length === 0) {
    return false;
  }
  for (const char of slug) {
    if (!SLUG_CHARS.has(char)) {
      return false;
    }
  }
  return true;
};

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .refine(isValidSlug, "slug must be lowercase alphanumeric or dashes"),
});

const buildOrgsRoutes = (deps: OrgsRouteDeps = {}): Hono => {
  const prisma = deps.prisma ?? defaultPrisma;
  const auth = deps.auth ?? defaultAuth;
  const provision = deps.provision ?? provisionCompany;
  const app = new Hono();

  app.post("/", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return unauthorized(c, "Sign in first");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError({ c, code: "INVALID_JSON", message: "Invalid JSON body", status: 400 });
    }
    const parsed = createOrgSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError({
        c,
        code: "INVALID_BODY",
        issues: parsed.error.issues,
        message: "Invalid body",
        status: 400,
      });
    }

    let org: { id: string; name: string; slug: string };
    try {
      org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: { name: parsed.data.name, slug: parsed.data.slug },
        });
        await tx.orgMembership.create({
          data: { orgId: created.id, role: "OWNER", userId: session.user.id },
        });
        await provision(tx, {
          id: created.id,
          name: created.name,
          slug: created.slug,
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return jsonError({ c, code: "SLUG_TAKEN", message: "Slug already in use", status: 409 });
      }
      throw error;
    }

    return c.json(
      {
        currentOrg: { id: org.id, name: org.name, role: "OWNER" as const, slug: org.slug },
        productProvisioned: true,
      },
      201,
    );
  });

  return app;
};

export { buildOrgsRoutes };
export type { OrgsRouteDeps };
