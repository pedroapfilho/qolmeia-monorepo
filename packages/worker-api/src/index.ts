type FetchInit = Omit<RequestInit, "body" | "method">;
type JsonRequestValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | ReadonlyArray<JsonRequestValue>
  | { readonly [key: string]: JsonRequestValue };

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
    // SAFETY: Delete endpoints bind T to null and HTTP 204 has no response body.
    // oxlint-disable-next-line no-unsafe-type-assertion
    return null as T;
  }
  // SAFETY: Callers bind T to the contract of the first-party route they request.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return res.json() as Promise<T>;
};

type SendMethod = "DELETE" | "PATCH" | "POST" | "PUT";

type BrowserApi = {
  apiGet: <T>(path: string, init?: FetchInit) => Promise<T>;
  apiSend: <T>(
    method: SendMethod,
    path: string,
    body?: JsonRequestValue,
    init?: FetchInit,
  ) => Promise<T>;
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
      body?: JsonRequestValue,
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

type ServerApiConfig = {
  basePath?: string;
  baseUrl: string;
  readCookieHeader: () => Promise<string>;
  readOrgId: () => Promise<string>;
};

type ServerApi = {
  apiGetServer: <T>(path: string) => Promise<T>;
};

const createServerApi = (config: ServerApiConfig): ServerApi => ({
  apiGetServer: async <T>(path: string): Promise<T> => {
    const [cookie, orgId] = await Promise.all([config.readCookieHeader(), config.readOrgId()]);
    const headers = new Headers({ Accept: "application/json", "X-Org-Id": orgId });
    if (cookie !== "") {
      headers.set("Cookie", cookie);
    }
    const res = await fetch(`${config.baseUrl}${config.basePath ?? ""}${path}`, {
      cache: "no-store",
      headers,
    });
    return handleResponse<T>(res);
  },
});

export { ApiError, createBrowserApi, createServerApi, handleResponse };
export type { BrowserApi, FetchInit, ServerApi, ServerApiConfig };
