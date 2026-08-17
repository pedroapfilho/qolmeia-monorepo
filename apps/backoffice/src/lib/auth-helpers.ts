import { createSessionHelpers } from "@repo/app-shell/session";

import { log } from "@/lib/observability";

const { getActiveOrgId, requireMembership } = createSessionHelpers({
  allow: ["OWNER", "STAFF"],
  log,
});

export { getActiveOrgId, requireMembership as requireStaff };
