import type { OrgRole, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import { sendWelcomeEmail as defaultSendWelcome } from "@repo/transactional";
import { Hono } from "hono";
import { z, ZodError } from "zod";

import { logActivity as defaultLogActivity } from "@/activity/log";
import { badRequest, forbidden, validationError } from "@/lib/api-response";
import { auth as defaultAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import type { StaffContextVars } from "@/middleware/require-staff";

type TeamPrisma = Pick<PrismaClient, "activityLog" | "orgMembership" | "user">;

type AuthApiLike = {
  api: {
    signInMagicLink: (args: { body: { callbackURL?: string; email: string } }) => Promise<unknown>;
  };
};

type TeamRouteDeps = {
  auth?: AuthApiLike;
  clientAppUrl?: string;
  fromEmail?: string;
  logActivity?: typeof defaultLogActivity;
  prisma?: TeamPrisma;
  resendApiKey?: string;
  sendWelcome?: typeof defaultSendWelcome;
};

const inviteSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
  role: z.enum(["STAFF", "CUSTOMER"]),
});

const buildTeamRoutes = (deps: TeamRouteDeps = {}): Hono<{ Variables: StaffContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const auth = deps.auth ?? (defaultAuth as unknown as AuthApiLike);
  const logActivity = deps.logActivity ?? defaultLogActivity;
  const sendWelcome = deps.sendWelcome ?? defaultSendWelcome;
  const resendApiKey = deps.resendApiKey ?? env.RESEND_API_KEY;
  const fromEmail = deps.fromEmail ?? env.AUTH_FROM_EMAIL ?? "noreply@qolmeia.ai";
  const clientAppUrl = deps.clientAppUrl ?? process.env.CLIENT_APP_URL ?? "http://localhost:3001";
  const backofficeUrl = process.env.WEB_APP_URL ?? "http://localhost:3000";

  const app = new Hono<{ Variables: StaffContextVars }>();

  // GET /team/members — list memberships in the current org. Joins to User
  // so the UI doesn't need a second round-trip for email/name.
  app.get("/members", async (c) => {
    const orgId = c.get("orgId");
    const rows = await prisma.orgMembership.findMany({
      include: {
        user: {
          select: { displayName: true, email: true, id: true, image: true, name: true },
        },
      },
      orderBy: { createdAt: "asc" },
      where: { orgId },
    });
    return c.json({
      items: rows.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        role: row.role,
        user: {
          displayName: row.user.displayName,
          email: row.user.email,
          id: row.user.id,
          image: row.user.image,
          name: row.user.name,
        },
      })),
    });
  });

  // POST /team/invite — find-or-create User + OrgMembership, then send the
  // role-appropriate email. OWNER role can't be invited from this endpoint
  // (orgs are seeded with one OWNER by the install flow).
  app.post("/invite", async (c) => {
    const orgId = c.get("orgId");
    const role = c.get("role");

    // Only OWNERs can issue invites. The requireStaff guard accepts both
    // OWNER and STAFF, so we narrow further here. (STAFF may still need to
    // invite customers later; for v0 we keep this conservative.)
    if (role !== "OWNER") {
      return forbidden(c, "Apenas o dono pode convidar membros");
    }

    let body: z.infer<typeof inviteSchema>;
    try {
      body = inviteSchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof ZodError) {
        return validationError(c, error);
      }
      return badRequest(c, "Invalid JSON body");
    }

    // Find-or-create the User. Email is unique in the schema; if the user
    // already exists, we attach a new membership for the current org.
    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    });
    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          email: body.email,
          // Better Auth requires `emailVerified` — leave false; the magic
          // link click + flow will flip it on first sign-in.
          emailVerified: false,
          name: body.name,
        },
      }));

    // Idempotent: don't create a duplicate membership if one exists for
    // (orgId, userId). Upserts keep the role on the existing row.
    const targetRole: OrgRole = body.role;
    await prisma.orgMembership.upsert({
      create: {
        orgId,
        role: targetRole,
        userId: user.id,
      },
      update: { role: targetRole },
      where: {
        userId_orgId: { orgId, userId: user.id },
      },
    });

    // Send the role-appropriate email. Magic-link for CUSTOMER → drops them
    // into the client app; welcome email for STAFF → backoffice login.
    if (body.role === "CUSTOMER") {
      // Better Auth's signInMagicLink endpoint kicks off the verification
      // token flow + invokes the configured sendMagicLink hook from
      // @repo/auth. We delegate so token generation stays inside Better
      // Auth (don't roll our own).
      await auth.api.signInMagicLink({
        body: {
          callbackURL: `${clientAppUrl}/auth/verify`,
          email: body.email,
        },
      });
    } else if (resendApiKey) {
      // STAFF welcome — no magic link; the user creates a password via the
      // standard register flow.
      await sendWelcome(
        {
          userEmail: body.email,
          username: body.name,
          verificationUrl: `${backofficeUrl}/login`,
        },
        { apiKey: resendApiKey, from: fromEmail },
      );
    }

    await logActivity({
      actorId: c.get("session").user.id,
      orgId,
      payload: { email: body.email, role: body.role },
      prisma,
      refId: user.id,
      refType: "ORGANIZATION",
      summary: `Convite enviado para ${body.email} (${body.role})`,
      type: "MEMBER_INVITED",
    });

    return c.json({
      member: {
        email: user.email,
        id: user.id,
        name: user.name,
        role: body.role,
      },
    });
  });

  return app;
};

export { buildTeamRoutes };
export type { TeamRouteDeps };
