import type { PrismaClient } from "@repo/db";
import { Prisma, prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";
import { z, ZodError } from "zod";

import { logActivity } from "@/activity/log";
import { forbidden, notFound, validationError } from "@/lib/api-response";
import type { StaffContextVars } from "@/middleware/require-staff";

type SoulPrisma = Pick<PrismaClient, "activityLog" | "organization">;

type SoulRouteDeps = {
  prisma?: SoulPrisma;
};

// businessProfile is an opaque JSON blob (the AI-extracted "soul"). We
// validate that it's an object so we don't accept arrays/primitives, but we
// don't pin the shape — the Designer agent owns that contract.
const businessProfileSchema = z
  .unknown()
  .refine((value) => value !== null && typeof value === "object" && !Array.isArray(value), {
    message: "businessProfile must be an object",
  });

// PUT body. Every field is optional but at least one must be provided.
const putSoulSchema = z
  .object({
    agentInstructions: z.string().max(20_000).nullable().optional(),
    businessIdea: z.string().max(20_000).nullable().optional(),
    businessProfile: businessProfileSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one of agentInstructions, businessIdea, or businessProfile is required",
  });

const buildSoulRoutes = (deps: SoulRouteDeps = {}): Hono<{ Variables: StaffContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const app = new Hono<{ Variables: StaffContextVars }>();

  // GET /soul — current org-curated context. businessProfile is the
  // AI-extracted soul (Designer-managed); the other two are owner-curated.
  app.get("/", async (c) => {
    const orgId = c.get("orgId");
    const org = await prisma.organization.findUnique({
      select: { agentInstructions: true, businessIdea: true, businessProfile: true },
      where: { id: orgId },
    });
    if (!org) {
      return notFound(c, "Organization not found");
    }
    return c.json({
      agentInstructions: org.agentInstructions,
      businessIdea: org.businessIdea,
      businessProfile: org.businessProfile,
    });
  });

  // PUT /soul — patch any of the three soul fields. businessProfile is
  // OWNER-only (it overrides the AI-extracted blob); the other two are
  // OWNER + STAFF since they're owner-curated text the team can co-edit.
  app.put("/", async (c) => {
    const orgId = c.get("orgId");
    const role = c.get("role");
    const session = c.get("session");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return validationError(
        c,
        new ZodError([
          { code: "custom", input: undefined, message: "Invalid JSON body", path: [] },
        ]),
      );
    }

    const parsed = putSoulSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(c, parsed.error);
    }

    if (Object.hasOwn(parsed.data, "businessProfile") && role !== "OWNER") {
      return forbidden(c, "Only OWNER can edit businessProfile");
    }

    // Build the data patch from the validated fields. Using
    // Object.hasOwn picks "field present in the request" (including
    // explicit null) over "field missing" so the route can null out a
    // value as well as set one. Prisma needs `Prisma.JsonNull` to write
    // a JSON null instead of leaving the column untouched.
    const data: Prisma.OrganizationUpdateInput = {};
    if (Object.hasOwn(parsed.data, "agentInstructions")) {
      data.agentInstructions = parsed.data.agentInstructions ?? null;
    }
    if (Object.hasOwn(parsed.data, "businessIdea")) {
      data.businessIdea = parsed.data.businessIdea ?? null;
    }
    if (Object.hasOwn(parsed.data, "businessProfile")) {
      const value = parsed.data.businessProfile;
      data.businessProfile =
        value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
    }

    const updated = await prisma.organization.update({
      data,
      select: { agentInstructions: true, businessIdea: true, businessProfile: true },
      where: { id: orgId },
    });

    // Fire-and-await one ActivityLog row per field that actually changed.
    // Matches the Telegram /instrucoes and /ideia paths so the timeline
    // shows the same event regardless of which surface the owner used.
    if (Object.hasOwn(parsed.data, "agentInstructions")) {
      await logActivity({
        actorId: session.user.id,
        orgId,
        payload: { length: parsed.data.agentInstructions?.length ?? 0 },
        prisma,
        refId: orgId,
        refType: "ORGANIZATION",
        summary: `${session.user.email} atualizou as instruções dos agentes`,
        type: "INSTRUCTIONS_UPDATED",
      });
    }
    if (Object.hasOwn(parsed.data, "businessIdea")) {
      await logActivity({
        actorId: session.user.id,
        orgId,
        payload: { length: parsed.data.businessIdea?.length ?? 0 },
        prisma,
        refId: orgId,
        refType: "ORGANIZATION",
        summary: `${session.user.email} atualizou a ideia do negócio`,
        type: "BUSINESS_IDEA_UPDATED",
      });
    }
    if (Object.hasOwn(parsed.data, "businessProfile")) {
      await logActivity({
        actorId: session.user.id,
        orgId,
        payload: { source: "backoffice" },
        prisma,
        refId: orgId,
        refType: "ORGANIZATION",
        summary: `${session.user.email} atualizou o perfil do negócio`,
        type: "OWNER_COMMAND",
      });
    }

    return c.json({
      agentInstructions: updated.agentInstructions,
      businessIdea: updated.businessIdea,
      businessProfile: updated.businessProfile,
    });
  });

  return app;
};

export { buildSoulRoutes, putSoulSchema };
export type { SoulRouteDeps };
