import { parseMeResponse, type Role } from "@/lib/membership";
import { buildCacheKey, readCachedString, writeCachedString } from "@/lib/session-cache";

type ValidatedSession = {
  companyId: string;
  role: Role;
  userId: string;
};

// Session gate. Validates a Better Auth session via `/api/v1/me` on the
// auth service and returns the resolved membership.
//
// Path-level role enforcement (CUSTOMER on agent paths, OWNER/STAFF on
// backoffice routes) is the caller's job — this function only resolves
// "who is this and which company are they in."
//
// Cache: when the SESSIONS KV binding is configured, successful lookups are
// memoised for SESSION_CACHE_TTL_SECONDS via the shared session-cache
// helpers. Misses fall through and refill the cache; failures don't cache.

const SESSION_CACHE_TTL_SECONDS = 60;
const SESSION_CACHE_NAMESPACE = "session";

const validateSession = async (request: Request, env: Env): Promise<ValidatedSession | null> => {
  const tokenParam = new URL(request.url).searchParams.get("cf_session");
  const cookieHeader = request.headers.get("Cookie");

  const headers: Record<string, string> = {};
  if (tokenParam) {
    headers.Authorization = `Bearer ${tokenParam}`;
  } else if (cookieHeader) {
    headers.Cookie = cookieHeader;
  } else {
    return null;
  }

  const cacheKey = await buildCacheKey({
    cookie: cookieHeader,
    namespace: SESSION_CACHE_NAMESPACE,
    token: tokenParam,
  });
  const cachedRaw = await readCachedString(env, cacheKey);
  if (cachedRaw) {
    try {
      const parsed = JSON.parse(cachedRaw) as ValidatedSession;
      if (parsed.companyId && parsed.role && parsed.userId) {
        return parsed;
      }
    } catch {
      // Corrupt cache entry — fall through to refresh.
    }
  }

  let response: Response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/me`, { headers });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[auth] /api/v1/me request failed", { error });
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

export { validateSession };
export type { ValidatedSession };
