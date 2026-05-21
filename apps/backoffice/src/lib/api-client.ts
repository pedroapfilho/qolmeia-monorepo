const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  // Empty 204 responses can't be JSON-parsed; treat them as null.
  if (res.status === 204) {
    return null as T;
  }
  return res.json() as Promise<T>;
};

const apiGet = async <T>(path: string, init?: FetchInit): Promise<T> => {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init),
    method: "GET",
  });
  return handleResponse<T>(res);
};

const apiSend = async <T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  init?: FetchInit,
): Promise<T> => {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    body: serialized,
    credentials: "include",
    headers: buildHeaders(init, serialized ? "application/json" : undefined),
    method,
  });
  return handleResponse<T>(res);
};

export { apiGet, ApiError, apiSend, API_URL };
export type { FetchInit };
