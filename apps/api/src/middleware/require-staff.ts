import type { OrgRole, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";

import { forbidden, unauthorized } from "@/lib/api-response";
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

const buildRoleGuard = (
  acceptedRoles: ReadonlyArray<OrgRole>,
  deps: RoleGuardDeps = {},
): MiddlewareHandler => {
  const auth = deps.auth ?? defaultAuth;
  const prisma = deps.prisma ?? defaultPrisma;

  return async (c: Context, next: Next) => {
    let session: AuthSession | null;
    try {
      session = await auth.api.getSession({ headers: c.req.raw.headers });
    } catch (error) {
      c.get("log").error("buildRoleGuard: getSession threw; auth service unavailable", {
        error,
        method: c.req.method,
        url: c.req.url,
      });
      throw new HTTPException(503, { message: "Authentication service unavailable" });
    }
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

const requireAnyMember = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["OWNER", "STAFF", "CUSTOMER"], deps);

export { buildRoleGuard, requireAnyMember };
export type { AuthLike, AuthSession, RoleGuardDeps, StaffContextVars };
