import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AGENTS_SERVER_URL } from "@/lib/api-server";
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

export const requireCustomer = async (): Promise<MeResponse> => {
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

  const me = (await res.json()) as MeResponse;
  if (me.role !== "CUSTOMER") {
    redirect("/no-access");
  }
  return me;
};
