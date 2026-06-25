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
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const cookieHeader = request.headers.get("Cookie");

  const token = bearerToken ?? tokenParam;

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (cookieHeader) {
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
  if (cachedRaw) {
    const parsed = safeJson<ValidatedSession | null>(cachedRaw, null);
    if (parsed?.companyId && parsed.role && parsed.userId) {
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

export { validateSession };
export type { ValidatedSession };
