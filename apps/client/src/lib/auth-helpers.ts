import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "@/lib/auth";
import { log } from "@/lib/observability";

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
// proxy already gates — this is the type-narrowing helper for the page.
export const requireSession = async () => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
};

type MeResponse = {
  currentOrg: {
    id: string;
    name: string;
    role: "OWNER" | "STAFF" | "CUSTOMER";
    slug: string;
  } | null;
  role: "OWNER" | "STAFF" | "CUSTOMER";
  user: {
    displayName: string | null;
    email: string;
    id: string;
    name: string;
  };
};

// Guards an RSC that requires CUSTOMER role. Bounces staff-only callers to
// /no-access. Genuine auth failures (401/403) redirect; transient failures
// (429, 5xx, network) throw so Next renders the error boundary.
//
// Why we don't catch-and-redirect on transient failures: proxy.ts already
// validated the session locally and let us through. Bouncing to /login
// while the cookie is valid makes proxy.ts redirect back to / (the auth-
// route-with-session rule), looping until the browser bails with
// ERR_TOO_MANY_REDIRECTS.
export const requireCustomer = async (): Promise<MeResponse> => {
  await requireSession();
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";
  const agentsUrl = process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://localhost:8787";

  const res = await fetch(`${agentsUrl}/api/me`, {
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

  const me = (await res.json()) as MeResponse;
  if (me.role !== "CUSTOMER") {
    redirect("/no-access");
  }
  return me;
};
