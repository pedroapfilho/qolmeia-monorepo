import type { PrismaClient } from "@repo/db";
import { Prisma, prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";
import { z } from "zod";

import { jsonError, unauthorized } from "@/lib/api-response";
import { auth as defaultAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

type OrgsPrisma = Pick<PrismaClient, "$transaction" | "organization" | "orgMembership">;

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
  fetch?: typeof fetch;
  prisma?: OrgsPrisma;
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

const provisionProductCompany = async (args: {
  companyId: string;
  fetchImpl: typeof fetch;
  name: string;
  slug: string;
}): Promise<{ ok: true } | { error: string; ok: false }> => {
  if (env.INTERNAL_SHARED_SECRET === undefined || env.INTERNAL_SHARED_SECRET === "") {
    return {
      error:
        "INTERNAL_SHARED_SECRET not configured on apps/api; set it and apps/agents to the same value",
      ok: false,
    };
  }
  const base = env.AGENTS_INTERNAL_URL.endsWith("/")
    ? env.AGENTS_INTERNAL_URL.slice(0, -1)
    : env.AGENTS_INTERNAL_URL;
  const url = `${base}/api/internal/companies`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.INTERNAL_SHARED_SECRET}`,
    "Content-Type": "application/json",
  };
  try {
    const res = await args.fetchImpl(url, {
      body: JSON.stringify({ id: args.companyId, name: args.name, slug: args.slug }),
      headers,
      method: "POST",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `agents responded ${res.status}: ${detail.slice(0, 200)}`, ok: false };
    }
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown error", ok: false };
  }
};

const buildOrgsRoutes = (deps: OrgsRouteDeps = {}): Hono => {
  const prisma = deps.prisma ?? defaultPrisma;
  const auth = deps.auth ?? defaultAuth;
  const fetchImpl = deps.fetch ?? fetch;
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
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return jsonError({ c, code: "SLUG_TAKEN", message: "Slug already in use", status: 409 });
      }
      throw error;
    }

    const relay = await provisionProductCompany({
      companyId: org.id,
      fetchImpl,
      name: org.name,
      slug: org.slug,
    });
    if (!relay.ok) {
      log.error({ companyId: org.id, error: relay.error, message: "[orgs] product relay failed" });
    }

    return c.json(
      {
        currentOrg: { id: org.id, name: org.name, role: "OWNER" as const, slug: org.slug },
        productProvisioned: relay.ok,
      },
      201,
    );
  });

  return app;
};

export { buildOrgsRoutes };
export type { OrgsRouteDeps };
