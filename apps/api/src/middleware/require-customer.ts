import type { MiddlewareHandler } from "hono";

import { buildRoleGuard, type AuthSession, type RoleGuardDeps } from "./require-staff";

// Mirror of requireStaff but for the future client app. Exported so the
// client-app routes can adopt it once they exist; not yet mounted by index.ts.
type CustomerContextVars = {
  orgId: string;
  role: "CUSTOMER";
  session: AuthSession;
};

const requireCustomer = (deps: RoleGuardDeps = {}): MiddlewareHandler =>
  buildRoleGuard(["CUSTOMER"], deps);

export { requireCustomer };
export type { CustomerContextVars };
