import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { safeJson } from "#/db/mappers";
import { logError } from "#/lib/logger";
import { parseMeResponse, type OrgSummary, type Role } from "#/lib/membership";
import { buildCacheKey, readCachedString, writeCachedString } from "#/lib/session-cache";

type ValidatedSession = {
  companyId: string;
  role: Role;
  userId: string;
};

const ME_CACHE_TTL_SECONDS = 60;
const ME_CACHE_NAMESPACE = "me";
const ORG_ID_HEADER = "X-Org-Id";
const ORG_ID_QUERY_PARAM = "org_id";

// EventSource cannot set request headers, so the SSE subscription names its org
// in the query string the same way it already passes cf_session.
const readOrgId = (request: Request): string | null => {
  const header = request.headers.get(ORG_ID_HEADER)?.trim() ?? "";
  if (header !== "") {
    return header;
  }
  const query = new URL(request.url).searchParams.get(ORG_ID_QUERY_PARAM)?.trim() ?? "";
  return query === "" ? null : query;
};

const orgSelectionRequired = (orgs: ReadonlyArray<OrgSummary>): HTTPException =>
  new HTTPException(400, {
    res: Response.json(
      {
        error: "org_required",
        message: `This account belongs to more than one organization; send the ${ORG_ID_HEADER} header to choose one`,
        orgs,
      },
      { status: 400 },
    ),
  });

type MeFetch =
  | { body: string; cached: boolean; kind: "upstream"; status: number }
  | { kind: "no-credentials" }
  | { kind: "unreachable" };

/**
 * The single door to the auth service's /api/me. Both readers used to own a
 * copy: `validateSession` accepted `Authorization: Bearer` while the relay
 * handler read only the `cf_session` query param, so a bearer-token client got
 * 401 from GET /api/me and 200 from GET /api/me/company. They also kept two KV
 * entries with two TTLs for one upstream answer. One entry holds the raw
 * upstream body so every reader sees the same bytes.
 */
const fetchMe = async (request: Request, env: Env): Promise<MeFetch> => {
  const tokenParam = new URL(request.url).searchParams.get("cf_session");
  const authHeader = request.headers.get("Authorization");
  const bearerToken =
    authHeader !== null && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieHeader = request.headers.get("Cookie");

  const token = bearerToken ?? tokenParam;
  const orgId = readOrgId(request);

  const headers: Record<string, string> = { Accept: "application/json" };
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
    logError("me.fetch.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "unreachable" };
  }

  const body = await response.text();
  if (response.ok) {
    await writeCachedString(env, cacheKey, body, ME_CACHE_TTL_SECONDS);
  }
  return { body, cached: false, kind: "upstream", status: response.status };
};

const validateSession = async (request: Request, env: Env): Promise<ValidatedSession | null> => {
  const result = await fetchMe(request, env);
  if (result.kind !== "upstream" || result.status !== 200) {
    return null;
  }

  const me = parseMeResponse(safeJson<unknown>(result.body, null));
  if (me === null) {
    return null;
  }
  if (me.currentOrg === null) {
    // The auth service answers /api/me for a multi-org caller with a null
    // currentOrg and the full list. Collapsing that into 401 sent the user back
    // to a login screen that could not fix it, so it surfaces as its own 400.
    if (me.orgs.length > 1) {
      throw orgSelectionRequired(me.orgs);
    }
    return null;
  }
  return {
    companyId: me.currentOrg.id,
    role: me.currentOrg.role,
    userId: me.userId,
  };
};

type SessionEnv = { Bindings: Env; Variables: { session: ValidatedSession } };

const requireSession: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  c.set("session", session);
  return next();
};

const requireStaffSession: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const session = await validateSession(c.req.raw, c.env);
  if (!session) {
    return c.text("Unauthorized", 401);
  }
  if (session.role !== "OWNER" && session.role !== "STAFF") {
    return c.text("Forbidden", 403);
  }
  c.set("session", session);
  return next();
};

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Every write behind a customer session is a customer action: STAFF and OWNER
 * operate through the backoffice router, which authorizes them separately.
 * Gating by method rather than by handler means a write route is guarded the
 * day it is added. The two that shipped unguarded (POST /api/me/uploads and
 * POST /api/teams/:companyId/confirm) were each a missing copy of a line that
 * every sibling handler had.
 */
const requireCustomerForWrites: MiddlewareHandler<SessionEnv> = (c, next) => {
  if (READ_ONLY_METHODS.has(c.req.method) || c.get("session").role === "CUSTOMER") {
    return next();
  }
  // Hono middleware must hand back a promise; the 403 is built synchronously.
  return Promise.resolve(c.json({ error: "forbidden" }, 403));
};

export { fetchMe, requireCustomerForWrites, requireSession, requireStaffSession, validateSession };
export type { ValidatedSession };
