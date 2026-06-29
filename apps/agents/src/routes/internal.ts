import { Hono } from "hono";
import { z } from "zod";

import { constantTimeEqual } from "#/lib/constant-time";

const internalRoutes = new Hono<{ Bindings: Env }>();

internalRoutes.use("*", async (c, next) => {
  const expected = c.env.INTERNAL_SHARED_SECRET;
  if (!expected) {
    return c.text("Internal endpoint disabled (missing INTERNAL_SHARED_SECRET)", 503);
  }
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ") || !constantTimeEqual(auth.slice(7), expected)) {
    return c.text("Forbidden", 403);
  }
  return await next();
});

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

const createCompanySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .refine(isValidSlug, "slug must be lowercase alphanumeric or dashes"),
});

internalRoutes.post("/companies", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = createCompanySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }

  const { id, name, slug } = parsed.data;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, ?, ?, 'America/Sao_Paulo', 'pt-BR', 'onboarding', NULL, ?, ?)`,
  )
    .bind(id, name, slug, now, now)
    .run();

  const corrId = `corr-${id}`;
  const plannerId = `planner-${id}`;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'Correspondente Qolmeia', NULL, 'active', ?, ?)`,
    ).bind(corrId, id, now, now),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, created_at, updated_at)
       VALUES (?, ?, 'planner', NULL, NULL, 'Planejador Qolmeia', NULL, 'active', ?, ?)`,
    ).bind(plannerId, id, now, now),
  ]);

  return c.json({ ok: true });
});

export { internalRoutes };
