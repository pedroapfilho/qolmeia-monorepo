import type { OrgRole } from "@repo/db";
import type { MiddlewareHandler } from "hono";

import { buildRoleGuard, type AuthSession, type RoleGuardDeps } from "./require-staff";

// Mirror of requireStaff but for the client app. Routes scoped to a
// customer session live under this guard (web-chat REST + SSE endpoints).
type CustomerContextVars = {
  orgId: string;
  role: "CUSTOMER";
  session: AuthSession;
};

// Generic "any membership" guard. Used by /api/v1/me so a single endpoint
// can serve staff + customer sessions — the page bouncers (backoffice
// requireStaff, client requireCustomer) handle role-specific gating
// further up in their respective Next layers.
type AnyMemberContextVars = {
  orgId: string;
  role: OrgRole;
  session: AuthSession;
};

const requireCustomer = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["CUSTOMER"], deps);

const requireAnyMember = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["OWNER", "STAFF", "CUSTOMER"], deps);

export { requireAnyMember, requireCustomer };
export type { AnyMemberContextVars, CustomerContextVars };
