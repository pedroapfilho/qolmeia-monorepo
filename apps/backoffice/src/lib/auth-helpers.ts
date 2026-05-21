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
    // Auth failures (DB down, misconfiguration) must not be silent — they
    // look identical to "logged out" without a log entry to diagnose.
    console.error("[auth-helpers] getSession failed", { error });
    return null;
  }
});

// Guards an RSC that requires *any* signed-in user. Use for routes that the
// proxy.ts already gates — this is the type-narrowing helper for the page.
export const requireSession = async () => {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
};

// Guards an RSC that requires OWNER or STAFF role in the current org. Role
// resolution lives in apps/api's require-staff middleware; the backoffice
// just trusts /api/v1/me's response. If the API rejects (non-staff), we
// bounce to /login. Future work: surface a "no access" page instead.
export const requireStaff = async () => {
  const session = await requireSession();
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  try {
    const res = await fetch(`${apiUrl}/api/v1/me`, {
      cache: "no-store",
      headers: { Accept: "application/json", Cookie: cookie },
    });

    if (res.status === 401 || res.status === 403) {
      redirect("/login");
    }

    if (!res.ok) {
      throw new Error(`/api/v1/me responded ${res.status}`);
    }

    return { me: await res.json(), session };
  } catch (error) {
    console.error("[auth-helpers] requireStaff failed", { error });
    redirect("/login");
  }
};
