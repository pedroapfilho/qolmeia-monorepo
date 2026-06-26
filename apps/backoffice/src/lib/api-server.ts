import { headers } from "next/headers";

import { ApiError } from "@/lib/api-client";

const AGENTS_SERVER_URL =
  process.env.AGENTS_INTERNAL_URL ?? process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://127.0.0.1:8787";

const apiGetServer = async <T>(path: string): Promise<T> => {
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";

  const res = await fetch(`${AGENTS_SERVER_URL}/api/backoffice${path}`, {
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
