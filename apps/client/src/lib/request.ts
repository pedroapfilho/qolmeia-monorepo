const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

const apiUrl = (path: string): string => `${AGENTS_URL}${path}`;

const request = async <T>(path: string, label: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(apiUrl(path), { credentials: "include", ...init });
  if (!res.ok) {
    throw new Error(`${label} failed (${res.status})`);
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- typed-fetch helper for first-party API routes; callers own T
  return (await res.json()) as T;
};

const jsonInit = (method: "PATCH" | "POST", body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
  method,
});

export { apiUrl, jsonInit, request };
