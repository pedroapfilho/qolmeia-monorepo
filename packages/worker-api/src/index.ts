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
  if (contentType !== undefined && contentType !== "" && !headers.has("Content-Type")) {
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
    // oxlint-disable-next-line no-unsafe-type-assertion -- 204 has no body; callers request T = null for delete endpoints
    return null as T;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- typed-fetch helper for first-party API routes; callers own T
  return res.json() as Promise<T>;
};

type SendMethod = "DELETE" | "PATCH" | "POST" | "PUT";

type BrowserApi = {
  apiGet: <T>(path: string, init?: FetchInit) => Promise<T>;
  apiSend: <T>(method: SendMethod, path: string, body?: unknown, init?: FetchInit) => Promise<T>;
  apiSendForm: <T>(path: string, formData: FormData, init?: FetchInit) => Promise<T>;
};

const createBrowserApi = (agentsUrl: string, basePath = ""): BrowserApi => {
  const url = (path: string): string => `${agentsUrl}${basePath}${path}`;
  return {
    apiGet: async <T>(path: string, init?: FetchInit): Promise<T> => {
      const res = await fetch(url(path), {
        ...init,
        credentials: "include",
        headers: buildHeaders(init),
        method: "GET",
      });
      return handleResponse<T>(res);
    },
    apiSend: async <T>(
      method: SendMethod,
      path: string,
      body?: unknown,
      init?: FetchInit,
    ): Promise<T> => {
      const serialized = body === undefined ? undefined : JSON.stringify(body);
      const res = await fetch(url(path), {
        ...init,
        body: serialized,
        credentials: "include",
        headers: buildHeaders(init, serialized === undefined ? undefined : "application/json"),
        method,
      });
      return handleResponse<T>(res);
    },
    apiSendForm: async <T>(path: string, formData: FormData, init?: FetchInit): Promise<T> => {
      const headers = buildHeaders(init);
      headers.delete("Content-Type");
      const res = await fetch(url(path), {
        ...init,
        body: formData,
        credentials: "include",
        headers,
        method: "POST",
      });
      return handleResponse<T>(res);
    },
  };
};

export { ApiError, createBrowserApi, handleResponse };
export type { BrowserApi, FetchInit };
