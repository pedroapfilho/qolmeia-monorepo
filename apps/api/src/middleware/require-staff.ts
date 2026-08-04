import type { OrgRole, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";

import { forbidden, jsonError, unauthorized } from "@/lib/api-response";
import { auth as defaultAuth } from "@/lib/auth";

const ORG_ID_HEADER = "X-Org-Id";

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

/**
 * The discovery guard leaves orgId and role null when the caller belongs to
 * more than one org, so a route mounted on it must handle "authenticated
 * member, org not chosen yet".
 */
type DiscoveryContextVars = {
  orgId: string | null;
  role: OrgRole | null;
  session: AuthSession;
};

type AmbiguousOrgPolicy = "allow-unscoped" | "reject";

type ResolvedMembership =
  | { kind: "ambiguous" }
  | { kind: "no-membership" }
  | { kind: "resolved"; orgId: string; role: OrgRole };

const readRequestedOrgId = (c: Context): string | null => {
  const value = c.req.header(ORG_ID_HEADER)?.trim() ?? "";
  return value === "" ? null : value;
};

const roleRequirement = (acceptedRoles: ReadonlyArray<OrgRole>): string =>
  acceptedRoles.length === 1
    ? `Requires ${acceptedRoles[0]} role`
    : `Requires one of: ${acceptedRoles.join(", ")}`;

const resolveMembership = async (
  prisma: RoleGuardPrisma,
  args: {
    acceptedRoles: ReadonlyArray<OrgRole>;
    requestedOrgId: string | null;
    userId: string;
  },
): Promise<ResolvedMembership> => {
  const where = { role: { in: [...args.acceptedRoles] }, userId: args.userId };

  if (args.requestedOrgId !== null) {
    const membership = await prisma.orgMembership.findFirst({
      where: { ...where, orgId: args.requestedOrgId },
    });
    return membership === null
      ? { kind: "no-membership" }
      : { kind: "resolved", orgId: membership.orgId, role: membership.role };
  }

  // Two rows is enough to know the caller has to name an org. Which orgs those
  // are is answered by GET /api/me, the one route mounted on the
  // "allow-unscoped" policy precisely so a caller can read the list before it
  // is able to name one.
  const memberships = await prisma.orgMembership.findMany({
    orderBy: { createdAt: "asc" },
    take: 2,
    where,
  });
  const single = memberships[0];
  if (single === undefined) {
    return { kind: "no-membership" };
  }
  if (memberships.length > 1) {
    return { kind: "ambiguous" };
  }
  return { kind: "resolved", orgId: single.orgId, role: single.role };
};

const buildRoleGuard = (
  acceptedRoles: ReadonlyArray<OrgRole>,
  deps: RoleGuardDeps = {},
  onAmbiguousOrg: AmbiguousOrgPolicy = "reject",
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

    const requestedOrgId = readRequestedOrgId(c);
    const membership = await resolveMembership(prisma, {
      acceptedRoles,
      requestedOrgId,
      userId: session.user.id,
    });

    if (membership.kind === "ambiguous") {
      if (onAmbiguousOrg === "reject") {
        return jsonError({
          c,
          code: "ORG_ID_REQUIRED",
          message: `This account belongs to more than one organization; send the ${ORG_ID_HEADER} header to choose one`,
          status: 400,
        });
      }

      c.set("session", session);
      c.set("orgId", null);
      c.set("role", null);

      return next();
    }

    if (membership.kind === "no-membership") {
      return forbidden(
        c,
        requestedOrgId === null
          ? roleRequirement(acceptedRoles)
          : `${roleRequirement(acceptedRoles)} in the requested organization`,
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

/**
 * Guards the org-list read itself. Rejecting an ambiguous caller here would be
 * a deadlock: the 400 asks for an org id that only this route can supply.
 */
const requireMemberForDiscovery = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["OWNER", "STAFF", "CUSTOMER"], deps, "allow-unscoped");

export { buildRoleGuard, requireAnyMember, requireMemberForDiscovery };
export type {
  AmbiguousOrgPolicy,
  AuthLike,
  AuthSession,
  DiscoveryContextVars,
  RoleGuardDeps,
  StaffContextVars,
};
