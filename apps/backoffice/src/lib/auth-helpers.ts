import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AGENTS_SERVER_URL } from "@/lib/api-server";
import { getAuth } from "@/lib/auth";
import { log } from "@/lib/observability";

import type { MeResponse } from "./api-types";

// Returns the current Better Auth session, or null if the cookie is missing
// or invalid. Cached per-request via React `cache` so multiple RSCs reading
// the session within the same render don't trigger duplicate DB hits.
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

// Guards an RSC that requires *any* signed-in user. Use for routes that the
// proxy.ts already gates — this is the type-narrowing helper for the page.
const requireSession = async () => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
};

// Guards an RSC that requires OWNER or STAFF role in the current org. Asks
// apps/agents' /api/me (which relays to the auth service for membership).
// Genuine auth failures (401/403) redirect; transient failures (429, 5xx,
// network errors) throw so Next renders the error boundary.
//
// Why we don't catch-and-redirect on transient failures: proxy.ts already
// validated the session locally and allowed the request through. Bouncing
// to /login here, while the cookie is valid, makes proxy.ts redirect back
// to / (auth-route-with-session rule), which loops forever — ERR_TOO_MANY_
// REDIRECTS. Throwing surfaces the underlying issue (rate limit, outage)
// instead of hiding it behind a spinning redirect.
export const requireStaff = async (): Promise<MeResponse> => {
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
    // 429 / 5xx / etc. — surface the failure rather than redirect.
    log.error({ message: "auth-helpers: /api/me transient failure", status: res.status });
    throw new Error(`/api/me responded ${res.status}`);
  }

  const me = (await res.json()) as MeResponse;
  if (me.role !== "OWNER" && me.role !== "STAFF") {
    redirect("/no-access");
  }
  return me;
};
