import { headers } from "next/headers";

import { ApiError, API_URL } from "@/lib/api-client";

// RSC fetch helper. Browser apiGet uses `credentials: "include"` which is
// meaningless in Node — server components must forward the Cookie header
// manually so the API's Better Auth middleware can see the session.
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
