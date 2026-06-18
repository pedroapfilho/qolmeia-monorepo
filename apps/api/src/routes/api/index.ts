import { Hono } from "hono";

import { requireAnyMember, type AnyMemberContextVars } from "@/middleware/require-staff";

import { buildMeRoutes } from "./me";
import { buildOrgsRoutes } from "./orgs";

type V1RouteDeps = {
  memberGuard?: ReturnType<typeof requireAnyMember>;
  routes?: {
    me?: ReturnType<typeof buildMeRoutes>;
    orgs?: ReturnType<typeof buildOrgsRoutes>;
  };
};

// Slim /api surface (mounted at /api by index.ts):
//   - /me   — any authenticated member (OWNER + STAFF + CUSTOMER)
//   - /orgs — authenticated; creates Organization + OrgMembership and
//             relays to apps/agents to provision the D1 company row.
const buildApiRoutes = (deps: V1RouteDeps = {}): Hono => {
  const app = new Hono();
  const memberGuard = deps.memberGuard ?? requireAnyMember();

  const meApp = new Hono<{ Variables: AnyMemberContextVars }>();
  meApp.use("*", memberGuard);
  meApp.route("/", deps.routes?.me ?? buildMeRoutes());
  app.route("/me", meApp);

  // /orgs is gated by a signed-in session (not by membership — a new user
  // signing up has no membership yet). The route resolves the session inline.
  app.route("/orgs", deps.routes?.orgs ?? buildOrgsRoutes());

  return app;
};

export { buildApiRoutes };
export type { V1RouteDeps };
