import { AGENTS_SERVER_URL } from "@repo/app-shell/agents-url";
import { createServerApi } from "@repo/worker-api";
import { headers } from "next/headers";

import { getActiveOrgId } from "@/lib/auth-helpers";

const { apiGetServer } = createServerApi({
  basePath: "/api/backoffice",
  baseUrl: AGENTS_SERVER_URL,
  readCookieHeader: async () => {
    const headersList = await headers();
    return headersList.get("cookie") ?? "";
  },
  readOrgId: getActiveOrgId,
});

export { apiGetServer };
