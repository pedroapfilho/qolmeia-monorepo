import { log } from "@repo/observability";
import { ORG_ROLES, type OrgRole } from "@repo/worker-api/contracts";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import { parseMeResponse, type OrgSummary } from "#/lib/membership";
import { buildCacheKey, readCachedString, writeCachedString } from "#/lib/session-cache";

type ValidatedSession = {
  companyId: string;
  role: OrgRole;
  userId: string;
};

const ME_CACHE_TTL_SECONDS = 60;
const ME_CACHE_NAMESPACE = "me";
const ORG_ID_HEADER = "X-Org-Id";
const ORG_ID_QUERY_PARAM = "org_id";

const readOrgId = (request: Request): string | null => {
  const header = request.headers.get(ORG_ID_HEADER)?.trim() ?? "";
  if (header !== "") {
    return header;
  }
  const query = new URL(request.url).searchParams.get(ORG_ID_QUERY_PARAM)?.trim() ?? "";
  return query === "" ? null : query;
};

const orgSelectionRequired = (orgs: ReadonlyArray<OrgSummary>): Response =>
  Response.json(
    {
      error: "org_required",
      message: `This account belongs to more than one organization; send the ${ORG_ID_HEADER} header to choose one`,
      orgs,
    },
    { status: 400 },
  );

type MeFetch =
  | { body: string; cached: boolean; kind: "upstream"; status: number }
  | { kind: "no-credentials" }
  | { kind: "unreachable" };

const fetchMe = async (request: Request, env: Env): Promise<MeFetch> => {
  const tokenParam = new URL(request.url).searchParams.get("cf_session");
  const authHeader = request.headers.get("Authorization");
  const bearerToken =
    authHeader !== null && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieHeader = request.headers.get("Cookie");

  const token = bearerToken ?? tokenParam;
  const orgId = readOrgId(request);

  type HeadersContract = Record<string, string>;

  const headers: HeadersContract = { Accept: "application/json" };
  if (token !== null && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  } else if (cookieHeader !== null && cookieHeader !== "") {
    headers.Cookie = cookieHeader;
  } else {
    return { kind: "no-credentials" };
  }
  if (orgId !== null) {
    headers[ORG_ID_HEADER] = orgId;
  }

  const cacheKey = await buildCacheKey({
    cookie: cookieHeader,
    namespace: ME_CACHE_NAMESPACE,
    orgId,
    token,
  });
  const cached = await readCachedString(env, cacheKey);
  if (cached !== null && cached !== "") {
    return { body: cached, cached: true, kind: "upstream", status: 200 };
  }

  let response: Response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/api/me`, { headers });
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      message: "me.fetch.failed",
    });
    return { kind: "unreachable" };
  }

  if (!response.ok) {
    return {
      body: await response.text(),
      cached: false,
      kind: "upstream",
      status: response.status,
    };
  }
  const body = await response.text();
  await writeCachedString(env, cacheKey, body, ME_CACHE_TTL_SECONDS);
  return { body, cached: false, kind: "upstream", status: response.status };
};

const jsonValueSchema = z.json();

type JsonValue = z.infer<typeof jsonValueSchema>;

const parseJson = (body: string): JsonValue | null => {
  try {
    return jsonValueSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
};

type SessionResult =
  | { kind: "ok"; session: ValidatedSession }
  | { kind: "org-required"; orgs: ReadonlyArray<OrgSummary> }
  | { kind: "unauthenticated" }
  | { kind: "upstream-unavailable" };

const validateSession = async (request: Request, env: Env): Promise<SessionResult> => {
  const result = await fetchMe(request, env);
  if (result.kind === "unreachable") {
    return { kind: "upstream-unavailable" };
  }
  if (result.kind !== "upstream" || result.status !== 200) {
    return { kind: "unauthenticated" };
  }

  const me = parseMeResponse(parseJson(result.body));
  if (me === null) {
    return { kind: "unauthenticated" };
  }
  if (me.currentOrg === null) {
    return me.orgs.length > 1
      ? { kind: "org-required", orgs: me.orgs }
      : { kind: "unauthenticated" };
  }
  return {
    kind: "ok",
    session: {
      companyId: me.currentOrg.id,
      role: me.currentOrg.role,
      userId: me.userId,
    },
  };
};

type SessionEnv = { Bindings: Env; Variables: { session: ValidatedSession } };

const sessionFailureResponse = (result: Exclude<SessionResult, { kind: "ok" }>): Response => {
  if (result.kind === "org-required") {
    return orgSelectionRequired(result.orgs);
  }
  if (result.kind === "upstream-unavailable") {
    return new Response("Auth service unreachable", { status: 502 });
  }
  return new Response("Unauthorized", { status: 401 });
};

type SessionGuardOptions = {
  allow: ReadonlySet<OrgRole>;
  scope?: (c: Context<SessionEnv>, session: ValidatedSession) => boolean;
};

/**
 * The only writer of the `session` context variable, which is why SessionEnv can
 * declare it non-optional: every admitting path here sets it.
 */
const sessionGuard =
  ({ allow, scope }: SessionGuardOptions): MiddlewareHandler<SessionEnv> =>
  async (c, next) => {
    const result = await validateSession(c.req.raw, c.env);
    if (result.kind !== "ok") {
      return sessionFailureResponse(result);
    }
    if (!allow.has(result.session.role)) {
      return c.text("Forbidden", 403);
    }
    if (scope !== undefined && !scope(c, result.session)) {
      return c.text("Forbidden", 403);
    }
    c.set("session", result.session);
    return next();
  };

const ANY_ROLE: ReadonlySet<OrgRole> = new Set(ORG_ROLES);
const STAFF_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(["OWNER", "STAFF"]);

const requireSession = sessionGuard({ allow: ANY_ROLE });
const requireStaffSession = sessionGuard({ allow: STAFF_ROLES });

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const requireCustomerForWrites: MiddlewareHandler<SessionEnv> = (c, next) => {
  if (READ_ONLY_METHODS.has(c.req.method) || c.get("session").role === "CUSTOMER") {
    return next();
  }
  return Promise.resolve(c.json({ error: "forbidden" }, 403));
};

export {
  fetchMe,
  requireCustomerForWrites,
  requireSession,
  requireStaffSession,
  sessionGuard,
  validateSession,
};
export type { SessionEnv, SessionResult, ValidatedSession };
