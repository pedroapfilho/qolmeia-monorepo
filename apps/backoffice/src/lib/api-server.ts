import { headers } from "next/headers";

import { ApiError, API_URL } from "@/lib/api-client";

// Server-side fetch helper. The browser-flavoured api-client uses
// `credentials: "include"`, which is meaningless in Node — RSCs must
// forward the incoming Cookie header manually so the API's Better Auth
// middleware can see the session.
const apiGetServer = async <T>(path: string): Promise<T> => {
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";

  const res = await fetch(`${API_URL}/api/v1${path}`, {
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

export { apiGetServer };
