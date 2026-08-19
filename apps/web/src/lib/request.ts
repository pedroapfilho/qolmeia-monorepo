const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";
type JsonRequestValue =
  | boolean
  | number
  | string
  | null
  | ReadonlyArray<JsonRequestValue>
  | { readonly [key: string]: JsonRequestValue };

const ME_PATH = "/api/me";

const apiUrl = (path: string, orgId?: string | null): string => {
  const base = `${AGENTS_URL}${path}`;
  if (orgId === undefined || orgId === null) {
    return base;
  }
  return `${base}${path.includes("?") ? "&" : "?"}org_id=${encodeURIComponent(orgId)}`;
};

type MeOrg = { id: string; role: string };

type MeBody = {
  currentOrg: MeOrg | null;
  orgs: ReadonlyArray<MeOrg>;
};

const fetchActiveOrgId = async (): Promise<string | null> => {
  const res = await fetch(apiUrl(ME_PATH), { credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET ${ME_PATH} failed (${res.status})`);
  }
  // SAFETY: The first-party /api/me route owns the MeBody response contract.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const body = (await res.json()) as MeBody;
  return body.currentOrg?.id ?? body.orgs.find((org) => org.role === "CUSTOMER")?.id ?? null;
};

type OrgDiscoveryContract = { promise: Promise<string | null> | null };

const orgDiscovery: OrgDiscoveryContract = { promise: null };

const activeOrgId = async (): Promise<string | null> => {
  orgDiscovery.promise ??= fetchActiveOrgId();
  try {
    return await orgDiscovery.promise;
  } catch (error) {
    orgDiscovery.promise = null;
    throw error;
  }
};

const withOrgId = (init: RequestInit | undefined, orgId: string | null): RequestInit => {
  const headers = new Headers(init?.headers);
  if (orgId !== null) {
    headers.set("X-Org-Id", orgId);
  }
  return { credentials: "include", ...init, headers: Object.fromEntries(headers) };
};

const request = async <T>(path: string, label: string, init?: RequestInit): Promise<T> => {
  const orgId = await activeOrgId();
  const res = await fetch(apiUrl(path), withOrgId(init, orgId));
  if (!res.ok) {
    throw new Error(`${label} failed (${res.status})`);
  }
  // SAFETY: Callers bind T to the contract of the first-party route they request.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return (await res.json()) as T;
};

const jsonInit = (method: "PATCH" | "POST", body: JsonRequestValue): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
  method,
});

export { activeOrgId, apiUrl, jsonInit, request };
