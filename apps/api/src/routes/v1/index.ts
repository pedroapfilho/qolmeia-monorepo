import { Hono } from "hono";

import {
  requireAnyMember,
  requireCustomer,
  type AnyMemberContextVars,
  type CustomerContextVars,
} from "@/middleware/require-customer";
import { requireStaff } from "@/middleware/require-staff";
import type { StaffContextVars } from "@/middleware/require-staff";

import { buildActivityRoutes } from "./activity";
import { buildAgentsRoutes } from "./agents";
import { buildApprovalsRoutes } from "./approvals";
import { buildMeRoutes } from "./me";
import { buildRunsRoutes } from "./runs";
import { buildSoulRoutes } from "./soul";
import { buildTeamRoutes } from "./team";
import { buildWebChatRoutes } from "./web-chat";

type V1RouteDeps = {
  customerGuard?: ReturnType<typeof requireCustomer>;
  // Used by /me so staff + customer sessions hit the same resolver.
  // Injectable so tests can stub the role-resolution without touching
  // require-staff's session lookup.
  memberGuard?: ReturnType<typeof requireAnyMember>;
  routes?: {
    activity?: ReturnType<typeof buildActivityRoutes>;
    agents?: ReturnType<typeof buildAgentsRoutes>;
    approvals?: ReturnType<typeof buildApprovalsRoutes>;
    me?: ReturnType<typeof buildMeRoutes>;
    runs?: ReturnType<typeof buildRunsRoutes>;
    soul?: ReturnType<typeof buildSoulRoutes>;
    team?: ReturnType<typeof buildTeamRoutes>;
    webChat?: ReturnType<typeof buildWebChatRoutes>;
  };
  staffGuard?: ReturnType<typeof requireStaff>;
};

// Single mount-point for /api/v1/*. The guard topology is:
//   - /me           → any authenticated org member (staff OR customer)
//   - /agents, /approvals, /activity, /soul, /runs, /team
//                   → OWNER or STAFF only
//   - /web-chat/*   → CUSTOMER only (the client app)
//
// Splitting like this lets one /api/v1 surface serve both apps without
// either dropping a customer into the backoffice's REST surface (cross-app
// data leak) or asking staff to authenticate twice.
const buildV1Routes = (deps: V1RouteDeps = {}): Hono => {
  const app = new Hono();
  const staffGuard = deps.staffGuard ?? requireStaff();
  const customerGuard = deps.customerGuard ?? requireCustomer();
  const memberGuard = deps.memberGuard ?? requireAnyMember();

  // /me — any authenticated user. The handler picks the right org via
  // c.get("orgId") which require-any-member resolves from OrgMembership.
  const meApp = new Hono<{ Variables: AnyMemberContextVars }>();
  meApp.use("*", memberGuard);
  meApp.route("/", deps.routes?.me ?? buildMeRoutes());
  app.route("/me", meApp);

  // Staff-gated surface: backoffice REST.
  const staffApp = new Hono<{ Variables: StaffContextVars }>();
  staffApp.use("*", staffGuard);
  staffApp.route("/agents", deps.routes?.agents ?? buildAgentsRoutes());
  staffApp.route("/approvals", deps.routes?.approvals ?? buildApprovalsRoutes());
  staffApp.route("/activity", deps.routes?.activity ?? buildActivityRoutes());
  staffApp.route("/soul", deps.routes?.soul ?? buildSoulRoutes());
  staffApp.route("/runs", deps.routes?.runs ?? buildRunsRoutes());
  staffApp.route("/team", deps.routes?.team ?? buildTeamRoutes());
  app.route("/", staffApp);

  // Customer-gated surface: web-chat REST + SSE.
  const customerApp = new Hono<{ Variables: CustomerContextVars }>();
  customerApp.use("*", customerGuard);
  customerApp.route("/", deps.routes?.webChat ?? buildWebChatRoutes());
  app.route("/web-chat", customerApp);

  return app;
};

export { buildV1Routes };
export type { V1RouteDeps };
