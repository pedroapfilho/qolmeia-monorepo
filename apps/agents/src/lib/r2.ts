// R2 helpers for asset storage + short-lived signed URLs.
//
// Asset URLs are HMAC-signed: `${baseUrl}/assets/${assetId}?token=<sig>.<exp>`.
// The Worker secret `ASSETS_SIGNING_KEY` is the only thing required to mint
// and verify them. Tokens are bound to a specific asset id and an expiry,
// so a leaked token only ever serves one asset for a bounded window.

const encoder = new TextEncoder();

type UploadInput = {
  bytes: ArrayBuffer | Uint8Array;
  key: string;
  metadata?: Record<string, string>;
  mime: string;
};

const uploadAsset = async (
  env: { ASSETS: R2Bucket },
  input: UploadInput,
): Promise<void> => {
  await env.ASSETS.put(input.key, input.bytes, {
    customMetadata: input.metadata,
    httpMetadata: { contentType: input.mime },
  });
};

const fetchAsset = (env: { ASSETS: R2Bucket }, key: string): Promise<R2ObjectBody | null> =>
  env.ASSETS.get(key);

const importHmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );

const toBase64Url = (bytes: ArrayBuffer): string => {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (const b of arr) {
    s += String.fromCodePoint(b);
  }
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const fromBase64Url = (s: string): Uint8Array => {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.codePointAt(i) ?? 0;
  }
  return out;
};

const signAssetToken = async (
  secret: string,
  assetId: string,
  ttlMs: number,
): Promise<string> => {
  const expiresAt = Date.now() + ttlMs;
  const key = await importHmacKey(secret);
  const payload = encoder.encode(`${assetId}.${expiresAt}`);
  const sig = await crypto.subtle.sign("HMAC", key, payload);
  return `${toBase64Url(sig)}.${expiresAt}`;
};

const verifyAssetToken = async (
  secret: string,
  assetId: string,
  token: string,
): Promise<boolean> => {
  const dot = token.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  const sigB64 = token.slice(0, dot);
  const expiresAtStr = token.slice(dot + 1);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }
  const key = await importHmacKey(secret);
  const sigBytes = fromBase64Url(sigB64);
  const payload = encoder.encode(`${assetId}.${expiresAt}`);
  return crypto.subtle.verify("HMAC", key, sigBytes, payload);
};

const buildSignedAssetUrl = async (
  env: { ASSETS_SIGNING_KEY: string },
  baseUrl: string,
  assetId: string,
  ttlMs = 15 * 60 * 1000,
): Promise<string> => {
  const token = await signAssetToken(env.ASSETS_SIGNING_KEY, assetId, ttlMs);
  return `${baseUrl.replace(/\/$/v, "")}/assets/${assetId}?token=${encodeURIComponent(token)}`;
};

export {
  buildSignedAssetUrl,
  fetchAsset,
  signAssetToken,
  uploadAsset,
  verifyAssetToken,
};
