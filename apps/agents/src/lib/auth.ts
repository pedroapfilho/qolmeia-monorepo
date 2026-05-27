import { parseMeResponse, type Role } from "@/lib/membership";

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
// memoised for SESSION_CACHE_TTL_SECONDS. The cache key is keyed on the
// bearer token (or a hash of the cookie header) so the same browser tab
// stops hammering the auth service. Misses fall through and refill the
// cache; failures don't cache.

// Cloudflare KV enforces a 60-second minimum on expirationTtl. Bumping the
// session cache below this throws at PUT time with a 400. 60s is still well
// inside the human reaction window for "I changed roles in Postgres and
// expect it to take effect."
const SESSION_CACHE_TTL_SECONDS = 60;

const sha256Hex = async (input: string): Promise<string> => {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(hash);
  let out = "";
  for (const byte of view) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
};

const buildCacheKey = async (
  token: string | null,
  cookie: string | null,
): Promise<string | null> => {
  if (token) {
    return `session:tok:${token}`;
  }
  if (cookie) {
    return `session:cookie:${await sha256Hex(cookie)}`;
  }
  return null;
};

const readCached = async (env: Env, cacheKey: string | null): Promise<ValidatedSession | null> => {
  if (!cacheKey || !env.SESSIONS) {
    return null;
  }
  try {
    const raw = await env.SESSIONS.get(cacheKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ValidatedSession;
    if (parsed.companyId && parsed.role && parsed.userId) {
      return parsed;
    }
    return null;
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[auth] session cache read failed", { error });
    return null;
  }
};

const writeCached = async (
  env: Env,
  cacheKey: string | null,
  session: ValidatedSession,
): Promise<void> => {
  if (!cacheKey || !env.SESSIONS) {
    return;
  }
  try {
    await env.SESSIONS.put(cacheKey, JSON.stringify(session), {
      expirationTtl: SESSION_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[auth] session cache write failed", { error });
  }
};

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

  const cacheKey = await buildCacheKey(tokenParam, cookieHeader);
  const cached = await readCached(env, cacheKey);
  if (cached) {
    return cached;
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
  await writeCached(env, cacheKey, validated);
  return validated;
};

export { validateSession };
export type { ValidatedSession };
