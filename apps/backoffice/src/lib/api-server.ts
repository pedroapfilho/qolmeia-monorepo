import { handleResponse } from "@repo/worker-api";
import { headers } from "next/headers";

import { AGENTS_SERVER_URL } from "@/lib/agents-url";
import { getActiveOrgId } from "@/lib/auth-helpers";

const apiGetServer = async <T>(path: string): Promise<T> => {
  const [headersList, orgId] = await Promise.all([headers(), getActiveOrgId()]);
  const cookie = headersList.get("cookie") ?? "";

  const res = await fetch(`${AGENTS_SERVER_URL}/api/backoffice${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-Org-Id": orgId,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  return handleResponse<T>(res);
};

export { apiGetServer };
