import type { OrgRole, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import type { Context, MiddlewareHandler, Next } from "hono";

import { auth as defaultAuth } from "@/lib/auth";

// Better Auth's session shape includes both the session row and the user row.
// We only narrow the fields we read downstream — the full shape lives in
// Better Auth's generated types.
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

// Variables we set on the Hono context so downstream route handlers can
// `c.get("session")` etc. Declared via Hono's `Variables` generic; route
// modules import this type to type their `Hono<{ Variables: StaffContextVars }>()`.
type StaffContextVars = {
  orgId: string;
  role: OrgRole;
  session: AuthSession;
};

const unauthorized = (c: Context) =>
  c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);

const forbidden = (c: Context, message: string) =>
  c.json({ error: { code: "FORBIDDEN", message } }, 403);

// Builds a middleware that gates a route group on a Better Auth session +
// an OrgMembership in one of the accepted roles. The matched membership's
// orgId and role are stashed on the context for downstream handlers.
//
// Multiple memberships per user are allowed (a user can be OWNER of one
// org and STAFF of another); we pick the first matching the role filter,
// ordered by createdAt asc for determinism. Future work will swap in a
// "currentOrgId" cookie so the user can switch orgs in the UI.
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

    await next();
  };
};

const requireStaff = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["OWNER", "STAFF"], deps);

export { buildRoleGuard, requireStaff };
export type { AuthLike, AuthSession, RoleGuardDeps, StaffContextVars };
