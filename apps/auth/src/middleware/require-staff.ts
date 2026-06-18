import { db as defaultDb, orgMembership, orgRole } from "@repo/db";
import { and, asc, eq, inArray } from "drizzle-orm";

type OrgRole = (typeof orgRole.enumValues)[number];
import type { Context, MiddlewareHandler, Next } from "hono";

import { auth as defaultAuth } from "@/lib/auth";

type AuthSession = {
  session: { id: string; userId: string };
  user: { email: string; id: string; name: string };
};

type DbLike = {
  query: {
    orgMembership: {
      findFirst: (args: unknown) => Promise<typeof orgMembership.$inferSelect | undefined>;
    };
  };
};

type AuthLike = {
  api: {
    getSession: (args: { headers: Headers }) => Promise<AuthSession | null>;
  };
};

type RoleGuardDeps = {
  auth?: AuthLike;
  db?: DbLike;
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
  const db = deps.db ?? defaultDb;

  return async (c: Context, next: Next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return unauthorized(c);
    }

    const membership = await db.query.orgMembership.findFirst({
      orderBy: asc(orgMembership.createdAt),
      where: and(
        eq(orgMembership.userId, session.user.id),
        inArray(orgMembership.role, [...acceptedRoles]),
      ),
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
export type { AnyMemberContextVars, AuthLike, AuthSession, DbLike, RoleGuardDeps, StaffContextVars };
