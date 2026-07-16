import { handleResponse } from "@repo/worker-api";
import { headers } from "next/headers";

const AGENTS_SERVER_URL =
  process.env.AGENTS_INTERNAL_URL ?? process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://127.0.0.1:8787";

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

  return handleResponse<T>(res);
};

export { AGENTS_SERVER_URL, apiGetServer };
