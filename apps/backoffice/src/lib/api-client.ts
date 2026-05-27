// Browser fetch helper for the backoffice. Targets the agents Worker's
// /api/backoffice/* surface. Auth flows through the same Better Auth cookie
// the auth service issued (forwarded via `credentials: "include"`).

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "http://localhost:8787";

type FetchInit = Omit<RequestInit, "body" | "method">;

class ApiError extends Error {
  body: string;
  status: number;

  constructor(status: number, body: string) {
    super(`API request failed (${status}): ${body}`);
    this.body = body;
    this.name = "ApiError";
    this.status = status;
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

const apiGet = async <T>(path: string, init?: FetchInit): Promise<T> => {
  const res = await fetch(`${AGENTS_URL}/api/backoffice${path}`, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init),
    method: "GET",
  });
  return handleResponse<T>(res);
};

const apiSend = async <T>(
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  path: string,
  body?: unknown,
  init?: FetchInit,
): Promise<T> => {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${AGENTS_URL}/api/backoffice${path}`, {
    ...init,
    body: serialized,
    credentials: "include",
    headers: buildHeaders(init, serialized ? "application/json" : undefined),
    method,
  });
  return handleResponse<T>(res);
};

export { AGENTS_URL, apiGet, ApiError, apiSend };
export type { FetchInit };
