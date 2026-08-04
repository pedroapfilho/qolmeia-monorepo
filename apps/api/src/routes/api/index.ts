import { Hono } from "hono";

import { requireMemberForDiscovery, type DiscoveryContextVars } from "@/middleware/require-staff";

import { buildMeRoutes } from "./me";
import { buildOrgsRoutes } from "./orgs";

type V1RouteDeps = {
  memberGuard?: ReturnType<typeof requireMemberForDiscovery>;
  routes?: {
    me?: ReturnType<typeof buildMeRoutes>;
    orgs?: ReturnType<typeof buildOrgsRoutes>;
  };
};

const buildApiRoutes = (deps: V1RouteDeps = {}): Hono => {
  const app = new Hono();
  // /me is the only route a caller can reach before it knows which org to name,
  // so it runs on the guard that tolerates an unresolved org rather than the
  // one that demands X-Org-Id.
  const memberGuard = deps.memberGuard ?? requireMemberForDiscovery();

  const meApp = new Hono<{ Variables: DiscoveryContextVars }>();
  meApp.use("*", memberGuard);
  meApp.route("/", deps.routes?.me ?? buildMeRoutes());
  app.route("/me", meApp);

  app.route("/orgs", deps.routes?.orgs ?? buildOrgsRoutes());

  return app;
};

export { buildApiRoutes };
export type { V1RouteDeps };
