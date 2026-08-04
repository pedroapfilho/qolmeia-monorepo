import { logError } from "#/lib/logger";

const KV_TTL_FLOOR_SECONDS = 60;

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

type CacheKeyInput = {
  cookie: string | null;
  namespace: string;
  orgId: string | null;
  token: string | null;
};

// orgId belongs in the key so one user's two orgs cannot share an entry, but it
// is client-supplied, so it goes through the digest instead of the key literal:
// keys stay fixed-length and nobody can pad a KV key from the outside.
const scopedDigest = (credential: string, orgId: string | null): Promise<string> =>
  sha256Hex(`${orgId ?? ""}:${credential}`);

const buildCacheKey = async (input: CacheKeyInput): Promise<string | null> => {
  if (input.token !== null && input.token !== "") {
    return `${input.namespace}:tok:${await scopedDigest(input.token, input.orgId)}`;
  }
  if (input.cookie !== null && input.cookie !== "") {
    return `${input.namespace}:cookie:${await scopedDigest(input.cookie, input.orgId)}`;
  }
  return null;
};

const describeCacheKey = (key: string): string => {
  const [namespace, kind] = key.split(":");
  return `${namespace ?? "unknown"}:${kind ?? "unknown"}`;
};

const readCachedString = async (env: Env, key: string | null): Promise<string | null> => {
  if (key === null || key === "") {
    return null;
  }
  try {
    return await env.SESSIONS.get(key);
  } catch (error) {
    logError("session-cache.read.err", {
      cache: describeCacheKey(key),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const writeCachedString = async (
  env: Env,
  key: string | null,
  value: string,
  ttlSeconds: number,
): Promise<void> => {
  if (key === null || key === "") {
    return;
  }
  try {
    await env.SESSIONS.put(key, value, {
      expirationTtl: Math.max(ttlSeconds, KV_TTL_FLOOR_SECONDS),
    });
  } catch (error) {
    logError("session-cache.write.err", {
      cache: describeCacheKey(key),
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export { buildCacheKey, readCachedString, writeCachedString };
export type { CacheKeyInput };
