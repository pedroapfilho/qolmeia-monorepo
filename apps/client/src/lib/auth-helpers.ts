import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AGENTS_SERVER_URL } from "@/lib/agents-url";
import { getAuth } from "@/lib/auth";
import { log } from "@/lib/observability";

const getSession = cache(async () => {
  const headersList = await headers();

  try {
    const session = await getAuth().api.getSession({
      headers: headersList,
    });

    return session;
  } catch (error) {
    log.error({ error, message: "auth-helpers: getSession failed" });
    return null;
  }
});

type OrgRole = "OWNER" | "STAFF" | "CUSTOMER";

type Org = {
  id: string;
  name: string;
  role: OrgRole;
  slug: string;
};

type MeResponse = {
  currentOrg: Org | null;
  orgs: ReadonlyArray<Org>;
  role: OrgRole | null;
  user: {
    displayName: string | null;
    email: string;
    id: string;
    name: string;
  };
};

type CustomerMe = MeResponse & { currentOrg: Org; role: "CUSTOMER" };

const requireSession = async () => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
};

/**
 * Deliberately sent without X-Org-Id: this is the discovery read, and a caller
 * forced to already know its org could never learn a second one. Cached so the
 * org-scoped reads reuse this answer instead of refetching it.
 */
const fetchMe = cache(async (): Promise<MeResponse> => {
  await requireSession();
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";
  const res = await fetch(`${AGENTS_SERVER_URL}/api/me`, {
    cache: "no-store",
    headers: { Accept: "application/json", Cookie: cookie },
  });

  if (res.status === 401) {
    redirect("/login");
  }
  if (res.status === 403) {
    redirect("/no-access");
  }
  if (!res.ok) {
    log.error({ message: "auth-helpers: /api/me transient failure", status: res.status });
    throw new Error(`/api/me responded ${res.status}`);
  }

  // oxlint-disable-next-line no-unsafe-type-assertion -- trusted first-party auth-service response; the role check below rejects malformed payloads
  return (await res.json()) as MeResponse;
});

/**
 * A multi-org account comes back with currentOrg null, so the app picks its own
 * default: the oldest membership that can use this app. /api/me orders orgs by
 * membership age, which is the tenant the guard used to pick on its own.
 */
const requireCustomer = async (): Promise<CustomerMe> => {
  const me = await fetchMe();
  const org = me.currentOrg ?? me.orgs.find((candidate) => candidate.role === "CUSTOMER") ?? null;
  if (org === null || org.role !== "CUSTOMER") {
    redirect("/no-access");
  }
  return { ...me, currentOrg: org, role: org.role };
};

const getActiveOrgId = async (): Promise<string> => {
  const me = await requireCustomer();
  return me.currentOrg.id;
};

export { getActiveOrgId, requireCustomer, requireSession };
