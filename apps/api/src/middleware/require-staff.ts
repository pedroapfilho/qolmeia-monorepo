import type { OrgRole, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import type { Context, MiddlewareHandler, Next } from "hono";

import { auth as defaultAuth } from "@/lib/auth";

type AuthSession = {
  session: { id: string; userId: string };
  user: { email: string; id: string; name: string };
};

type RoleGuardPrisma = Pick<PrismaClient, "orgMembership">;

type AuthLike = {
  api: {
    getSession: (args: { headers: Headers }) => Promise<AuthSession | null>;
  };
};

type RoleGuardDeps = {
  auth?: AuthLike;
  prisma?: RoleGuardPrisma;
};

type StaffContextVars = {
  orgId: string;
  role: OrgRole;
  session: AuthSession;
};

type AnyMemberContextVars = StaffContextVars;

const unauthorized = (c: Context) =>
  c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);

const forbidden = (c: Context, message: string) =>
  c.json({ error: { code: "FORBIDDEN", message } }, 403);

const buildRoleGuard = (
  acceptedRoles: ReadonlyArray<OrgRole>,
  deps: RoleGuardDeps = {},
): MiddlewareHandler => {
  const auth = deps.auth ?? (defaultAuth as unknown as AuthLike);
  const prisma = deps.prisma ?? defaultPrisma;

  return async (c: Context, next: Next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return unauthorized(c);
    }

    const membership = await prisma.orgMembership.findFirst({
      orderBy: { createdAt: "asc" },
      where: {
        role: { in: [...acceptedRoles] },
        userId: session.user.id,
      },
    });

    if (!membership) {
      return forbidden(
        c,
        acceptedRoles.length === 1
          ? `Requires ${acceptedRoles[0]} role`
          : `Requires one of: ${acceptedRoles.join(", ")}`,
      );
    }

    c.set("session", session);
    c.set("orgId", membership.orgId);
    c.set("role", membership.role);

    return next();
  };
};

const requireStaff = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["OWNER", "STAFF"], deps);

const requireAnyMember = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["OWNER", "STAFF", "CUSTOMER"], deps);

export { buildRoleGuard, requireAnyMember, requireStaff };
export type { AnyMemberContextVars, AuthLike, AuthSession, RoleGuardDeps, StaffContextVars };
