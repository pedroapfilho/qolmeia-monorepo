import type { MiddlewareHandler } from "hono";

import { safeJson } from "#/db/mappers";
import { parseMeResponse, type Role } from "#/lib/membership";
import { buildCacheKey, readCachedString, writeCachedString } from "#/lib/session-cache";

type ValidatedSession = {
  companyId: string;
  role: Role;
  userId: string;
};

const SESSION_CACHE_TTL_SECONDS = 60;
const SESSION_CACHE_NAMESPACE = "session";

const validateSession = async (request: Request, env: Env): Promise<ValidatedSession | null> => {
  const tokenParam = new URL(request.url).searchParams.get("cf_session");
  const authHeader = request.headers.get("Authorization");
  const bearerToken =
    authHeader !== null && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieHeader = request.headers.get("Cookie");

  const token = bearerToken ?? tokenParam;

  const headers: Record<string, string> = {};
  if (token !== null && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  } else if (cookieHeader !== null && cookieHeader !== "") {
    headers.Cookie = cookieHeader;
  } else {
    return null;
  }

  const cacheKey = await buildCacheKey({
    cookie: cookieHeader,
    namespace: SESSION_CACHE_NAMESPACE,
    token,
  });
  const cachedRaw = await readCachedString(env, cacheKey);
  if (cachedRaw !== null && cachedRaw !== "") {
    const parsed = safeJson<ValidatedSession | null>(cachedRaw, null);
    if (
      parsed !== null &&
      parsed.companyId !== "" &&
      typeof parsed.role === "string" &&
      parsed.userId !== ""
    ) {
      return parsed;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/api/me`, { headers });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[auth] /api/me request failed", { error });
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const me = parseMeResponse(await response.json());
  if (!me?.currentOrg) {
    return null;
  }
  const validated: ValidatedSession = {
    companyId: me.currentOrg.id,
    role: me.currentOrg.role,
    userId: me.userId,
  };
  await writeCachedString(env, cacheKey, JSON.stringify(validated), SESSION_CACHE_TTL_SECONDS);
  return validated;
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
const requireCustomerForWrites: MiddlewareHandler<{
  Bindings: Env;
  Variables: { session: ValidatedSession };
}> = (c, next) => {
  if (READ_ONLY_METHODS.has(c.req.method) || c.get("session").role === "CUSTOMER") {
    return next();
  }
  // Hono middleware must hand back a promise; the 403 is built synchronously.
  return Promise.resolve(c.json({ error: "forbidden" }, 403));
};

export { requireCustomerForWrites, validateSession };
export type { ValidatedSession };
