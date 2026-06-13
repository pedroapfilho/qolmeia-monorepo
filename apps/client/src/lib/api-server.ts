import { headers } from "next/headers";

import { ApiError } from "@/lib/api-client";

// Server-side base for the agents Worker. The browser rides the /api/me/*
// and /api/teams/* rewrites (same-origin cookie), but RSCs need an absolute
// URL — the rewrite only exists for inbound browser requests. 127.0.0.1 over
// `localhost` for the same IPv6-resolution reason as next.config.ts.
const AGENTS_SERVER_URL =
  process.env.AGENTS_INTERNAL_URL ?? process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://127.0.0.1:8787";

// RSC fetch helper targeting apps/agents. Browser fetch uses
// `credentials: "include"` which is meaningless in Node — server components
// must forward the Cookie header manually so the Worker's validateSession
// middleware can see the session.
const apiGetServer = async <T>(path: string): Promise<T> => {
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";

  const res = await fetch(`${AGENTS_SERVER_URL}${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) {
    return null as T;
  }
  return res.json() as Promise<T>;
};

export { AGENTS_SERVER_URL, apiGetServer };
