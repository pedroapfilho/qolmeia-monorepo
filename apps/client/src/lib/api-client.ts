// Client-side fetch helpers targeting apps/agents (the live product runtime).
// All product data — company state, assets, activity, uploads — lives on the
// agents Worker; the auth service (apps/api) is reached only by Better Auth's
// own client (see auth-client.ts).
//
// Default is "" (same-origin): next.config.ts rewrites /api/me/* and
// /api/teams/* to the Worker, so the session cookie stays first-party
// (`.localhost` is a public suffix — no cookie ever reaches localhost:8787
// cross-origin under portless). NEXT_PUBLIC_AGENTS_URL only overrides for a
// genuinely cross-origin prod Worker deployment.

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

type FetchInit = Omit<RequestInit, "body" | "method">;

class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`API request failed (${status}): ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const buildHeaders = (init?: FetchInit, contentType?: string): Headers => {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (contentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", contentType);
  }
  return headers;
};

const handleResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) {
    return null as T;
  }
  return res.json() as Promise<T>;
};

const apiSendForm = async <T>(path: string, formData: FormData, init?: FetchInit): Promise<T> => {
  // FormData sets its own Content-Type with boundary — let the browser do it.
  const headers = buildHeaders(init);
  headers.delete("Content-Type");
  const res = await fetch(`${AGENTS_URL}${path}`, {
    ...init,
    body: formData,
    credentials: "include",
    headers,
    method: "POST",
  });
  return handleResponse<T>(res);
};

export { ApiError, apiSendForm };
export type { FetchInit };
