import { Hono } from "hono";

import type { StaffContextVars } from "@/middleware/require-staff";
import { requireStaff } from "@/middleware/require-staff";

import { buildActivityRoutes } from "./activity";
import { buildAgentsRoutes } from "./agents";
import { buildApprovalsRoutes } from "./approvals";
import { buildMeRoutes } from "./me";
import { buildRunsRoutes } from "./runs";
import { buildSoulRoutes } from "./soul";

type V1RouteDeps = {
  routes?: {
    activity?: ReturnType<typeof buildActivityRoutes>;
    agents?: ReturnType<typeof buildAgentsRoutes>;
    approvals?: ReturnType<typeof buildApprovalsRoutes>;
    me?: ReturnType<typeof buildMeRoutes>;
    runs?: ReturnType<typeof buildRunsRoutes>;
    soul?: ReturnType<typeof buildSoulRoutes>;
  };
  staffGuard?: ReturnType<typeof requireStaff>;
};

// Single mount-point for /api/v1/*. Every sub-router is build-able (no
// top-level Prisma access) so tests can swap mocks in without standing up
// the real client. The role guard is also build-able for the same reason.
const buildV1Routes = (deps: V1RouteDeps = {}): Hono<{ Variables: StaffContextVars }> => {
  const app = new Hono<{ Variables: StaffContextVars }>();
  const staffGuard = deps.staffGuard ?? requireStaff();

  // All /api/v1/* endpoints require an authenticated OWNER or STAFF session.
  app.use("*", staffGuard);

  app.route("/agents", deps.routes?.agents ?? buildAgentsRoutes());
  app.route("/approvals", deps.routes?.approvals ?? buildApprovalsRoutes());
  app.route("/activity", deps.routes?.activity ?? buildActivityRoutes());
  app.route("/soul", deps.routes?.soul ?? buildSoulRoutes());
  app.route("/runs", deps.routes?.runs ?? buildRunsRoutes());
  app.route("/me", deps.routes?.me ?? buildMeRoutes());

  return app;
};

export { buildV1Routes };
export type { V1RouteDeps };
