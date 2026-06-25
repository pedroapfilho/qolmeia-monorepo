// Session-scoped KV cache primitives.
//
// Two paths in the Worker memoise auth-service responses keyed on the
// caller's session: `validateSession` (lib/auth.ts) caches the resolved
// `{ userId, companyId, role }`; the `GET /api/me` relay caches the raw
// response body so subsequent page renders short-circuit before touching
// the auth service. Both used to open-code identical sha256 + KV plumbing.
//
// This module owns:
//   - the cache-key shape (`<namespace>:tok:<token>` or
//     `<namespace>:cookie:<sha256>`).
//   - the SESSIONS KV binding choice.
//   - the read/write semantics: failures don't throw (Worker keeps serving;
//     the cache miss path will refresh the value).
//
// Per Cloudflare KV's contract, `expirationTtl` floors at 60 seconds.
// The two call sites both use 60s; the helper enforces the floor so a
// future bug can't ship a 30s TTL that fails at PUT time.

import { logError } from "#/lib/logger";

// This module deals only in opaque strings — the caller picks the
// (de)serializer. validateSession (lib/auth.ts) JSON.parse's into
// ValidatedSession; the /api/me relay just hands the raw body back to
// the client.

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
  token: string | null;
};

// Returns null when both credentials are absent — caller treats this the
// same as a cache miss with no-store semantics (don't write either).
const buildCacheKey = async (input: CacheKeyInput): Promise<string | null> => {
  if (input.token) {
    return `${input.namespace}:tok:${input.token}`;
  }
  if (input.cookie) {
    return `${input.namespace}:cookie:${await sha256Hex(input.cookie)}`;
  }
  return null;
};

const readCachedString = async (env: Env, key: string | null): Promise<string | null> => {
  if (!key || !env.SESSIONS) {
    return null;
  }
  try {
    return await env.SESSIONS.get(key);
  } catch (error) {
    logError("session-cache.read.err", {
      error: error instanceof Error ? error.message : String(error),
      key,
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
  if (!key || !env.SESSIONS) {
    return;
  }
  try {
    await env.SESSIONS.put(key, value, {
      expirationTtl: Math.max(ttlSeconds, KV_TTL_FLOOR_SECONDS),
    });
  } catch (error) {
    logError("session-cache.write.err", {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
  }
};

export { buildCacheKey, readCachedString, writeCachedString };
export type { CacheKeyInput };
