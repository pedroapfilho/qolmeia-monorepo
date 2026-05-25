import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "@/lib/auth";

// Returns the current Better Auth session, or null if the cookie is missing
// or invalid. Cached per-request via React `cache` so multiple RSCs reading
// the session within the same render don't trigger duplicate DB hits.
export const getSession = cache(async () => {
  const headersList = await headers();

  try {
    const session = await getAuth().api.getSession({
      headers: headersList,
    });

    return session;
  } catch (error) {
    console.error("[auth-helpers] getSession failed", { error });
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
// /no-access rather than letting them hit a customer page and see 403 toasts.
// P7.0: this calls apps/agents' /api/me (which relays to the auth service)
// instead of apps/api directly. Membership data still ultimately comes from
// Postgres via the relay; full ownership moves to D1 in a later phase.
export const requireCustomer = async (): Promise<MeResponse> => {
  await requireSession();
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";
  const agentsUrl = process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://localhost:8787";

  try {
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
      throw new Error(`/api/me responded ${res.status}`);
    }

    const me = (await res.json()) as MeResponse;
    if (me.role !== "CUSTOMER") {
      redirect("/no-access");
    }
    return me;
  } catch (error) {
    console.error("[auth-helpers] requireCustomer failed", { error });
    redirect("/login");
  }
};
