import { Hono } from "hono";

import { requireAnyMember, type StaffContextVars } from "@/middleware/require-staff";

import { buildMeRoutes } from "./me";
import { buildOrgsRoutes } from "./orgs";

type V1RouteDeps = {
  memberGuard?: ReturnType<typeof requireAnyMember>;
  routes?: {
    me?: ReturnType<typeof buildMeRoutes>;
    orgs?: ReturnType<typeof buildOrgsRoutes>;
  };
};

const buildApiRoutes = (deps: V1RouteDeps = {}): Hono => {
  const app = new Hono();
  const memberGuard = deps.memberGuard ?? requireAnyMember();

  const meApp = new Hono<{ Variables: StaffContextVars }>();
  meApp.use("*", memberGuard);
  meApp.route("/", deps.routes?.me ?? buildMeRoutes());
  app.route("/me", meApp);

  app.route("/orgs", deps.routes?.orgs ?? buildOrgsRoutes());

  return app;
};

export { buildApiRoutes };
export type { V1RouteDeps };
