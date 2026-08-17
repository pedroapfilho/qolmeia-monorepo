import { handleResponse } from "@repo/worker-api";
import type { MeOrg, MeResponse, OrgRole } from "@repo/worker-api/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AGENTS_SERVER_URL } from "./agents-url";
import { getAuth, type Auth } from "./auth-server";

type AppLogger = { error: (fields: Record<string, unknown>) => void };

type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

type ScopedMe<Role extends OrgRole> = MeResponse & { currentOrg: MeOrg; role: Role };

type SessionHelpers<Role extends OrgRole> = {
  getActiveOrgId: () => Promise<string>;
  requireMembership: () => Promise<ScopedMe<Role>>;
  requireSession: () => Promise<AuthSession>;
};

/**
 * `allow` is an allow-list on both surfaces on purpose. The customer app and the
 * operator panel previously expressed the same rule in opposite directions (one
 * listed the role it accepted, the other the role it rejected), so adding a
 * fourth OrgRole would have silently admitted it to the operator panel.
 */
const createSessionHelpers = <Role extends OrgRole>(config: {
  allow: ReadonlyArray<Role>;
  log: AppLogger;
}): SessionHelpers<Role> => {
  const isAllowed = (role: OrgRole): role is Role =>
    config.allow.some((candidate) => candidate === role);

  const getSession = cache(async () => {
    const headersList = await headers();
    try {
      return await getAuth().api.getSession({ headers: headersList });
    } catch (error) {
      config.log.error({ error, message: "app-shell: getSession failed" });
      return null;
    }
  });

  const requireSession = async (): Promise<AuthSession> => {
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
      config.log.error({ message: "app-shell: /api/me transient failure", status: res.status });
      throw new Error(`/api/me responded ${res.status}`);
    }

    return handleResponse<MeResponse>(res);
  });

  /**
   * A multi-org account comes back with currentOrg null, so the app picks its own
   * default: the oldest membership that can use this app. /api/me orders orgs by
   * membership age, which is the tenant the guard used to pick on its own.
   */
  const requireMembership = async (): Promise<ScopedMe<Role>> => {
    const me = await fetchMe();
    const org = me.currentOrg ?? me.orgs.find((candidate) => isAllowed(candidate.role)) ?? null;
    if (org === null || !isAllowed(org.role)) {
      redirect("/no-access");
    }
    return { ...me, currentOrg: org, role: org.role };
  };

  return {
    getActiveOrgId: async () => {
      const membership = await requireMembership();
      return membership.currentOrg.id;
    },
    requireMembership,
    requireSession,
  };
};

export { createSessionHelpers };
export type { AppLogger, ScopedMe, SessionHelpers };
