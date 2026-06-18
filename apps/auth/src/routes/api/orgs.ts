import { db as defaultDb, orgMembership, organization } from "@repo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { auth as defaultAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

// POST /api/orgs — create an Organization + OWNER OrgMembership for the
// signed-in user, then relay the new company id to apps/agents to provision
// the matching D1 `company` row.
//
// This is the org-create hook called out in P7.2: today seeds are hand-rolled
// with the Drizzle row and the D1 row created out-of-band; production needs
// the relay so signing up just-works without a one-shot script.
//
// The relay uses INTERNAL_SHARED_SECRET as a Bearer token against the agents
// Worker. If unset (dev default), the call still goes out and the receiver
// can decide to accept-anything in dev. If the relay fails, the route still
// returns 201 — the operator can run `wrangler d1 execute` manually to
// reconcile. (D1 rows are cheap; the user-facing failure mode is bad UX, not
// data corruption.)

// `transaction` is needed so the org + OWNER membership commit atomically (no
// orphaned tenant if the membership write fails).

type PostgresError = { code: string };

const isPostgresError = (err: unknown): err is PostgresError =>
  err instanceof Error && "code" in err && typeof (err as PostgresError).code === "string";

type DbLike = {
  transaction: <T>(fn: (tx: DbLike) => Promise<T>) => Promise<T>;
  insert: (
    table: unknown,
  ) => { values: (data: unknown) => { returning: () => Promise<ReadonlyArray<unknown>> } };
  query: {
    organization: {
      findFirst: (args: unknown) => Promise<{ id: string; name: string; slug: string } | undefined>;
    };
  };
};

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
  db?: DbLike;
};

// Slug validator. Not a regex because oxlint's /v parser and V8's /v parser
// disagree on where `-` is legal inside a character class — every shape that
// satisfied one rejected the other. Not a charCode range (the earlier
// approach) because oxlint and oxfmt fight over hex-digit case. A plain
// Set membership check is unambiguous in every parser and tool.
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

const provisionD1Company = async (args: {
  companyId: string;
  fetchImpl: typeof fetch;
  name: string;
  slug: string;
}): Promise<{ ok: true } | { error: string; ok: false }> => {
  // Fail closed when the shared secret is missing on this side. The agents
  // Worker also fails closed (returns 503), so sending unsigned would just
  // log a confusing "agents responded 503" with no clue that the local
  // config is the problem. Surfacing it here is more useful in dev.
  if (!env.INTERNAL_SHARED_SECRET) {
    return {
      error:
        "INTERNAL_SHARED_SECRET not configured on apps/auth — set it and apps/agents to the same value",
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
  const db = deps.db ?? defaultDb;
  const auth = deps.auth ?? (defaultAuth as unknown as AuthLike);
  const fetchImpl = deps.fetch ?? fetch;
  const app = new Hono();

  app.post("/", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Sign in first" } }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: "INVALID_JSON", message: "Invalid JSON body" } }, 400);
    }
    const parsed = createOrgSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_BODY", issues: parsed.error.issues, message: "Invalid body" } },
        400,
      );
    }

    // Fast, friendly 409 for the common case. The transaction's 23505 catch
    // below is the real guard against the check-then-act slug race (two
    // concurrent creates both pass this check; the loser hits the unique
    // constraint).
    const existing = await db.query.organization.findFirst({
      where: eq(organization.slug, parsed.data.slug),
    });
    if (existing) {
      return c.json({ error: { code: "SLUG_TAKEN", message: "Slug already in use" } }, 409);
    }

    let org: { id: string; name: string; slug: string };
    try {
      // Org + OWNER membership commit together or not at all — a failed
      // membership write must never leave an owner-less, unreachable tenant.
      org = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(organization)
          .values({ name: parsed.data.name, slug: parsed.data.slug })
          .returning();
        await tx
          .insert(orgMembership)
          .values({ orgId: (created as { id: string }).id, role: "OWNER", userId: session.user.id })
          .returning();
        return created as { id: string; name: string; slug: string };
      });
    } catch (error) {
      if (isPostgresError(error) && error.code === "23505") {
        return c.json({ error: { code: "SLUG_TAKEN", message: "Slug already in use" } }, 409);
      }
      throw error;
    }

    const relay = await provisionD1Company({
      companyId: org.id,
      fetchImpl,
      name: org.name,
      slug: org.slug,
    });
    if (!relay.ok) {
      log.error({ companyId: org.id, error: relay.error, message: "[orgs] D1 relay failed" });
    }

    return c.json(
      {
        currentOrg: { id: org.id, name: org.name, role: "OWNER" as const, slug: org.slug },
        d1Provisioned: relay.ok,
      },
      201,
    );
  });

  return app;
};

export { buildOrgsRoutes };
export type { OrgsRouteDeps };
