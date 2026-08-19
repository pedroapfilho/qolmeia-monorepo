type VerifyResult = { kind: "disabled" } | { kind: "forbidden" } | { kind: "ok" };

const BEARER_PREFIX = "Bearer ";

const constantTimeEqual = (a: string, b: string): boolean => {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  let diff = aBytes.length ^ bBytes.length;
  const max = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < max; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
};

const readBearerToken = (header: string | null | undefined): string | null => {
  if (header === null || header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  return header.slice(BEARER_PREFIX.length);
};

/**
 * An unset `expected` disables the service instead of authenticating every request.
 * Callers keep "disabled" separate from "forbidden" for deployment diagnosis.
 */
const verifyInternalSecret = (input: {
  expected: string | undefined;
  header: string | null | undefined;
}): VerifyResult => {
  if (input.expected === undefined || input.expected === "") {
    return { kind: "disabled" };
  }
  const token = readBearerToken(input.header);
  if (token === null || !constantTimeEqual(token, input.expected)) {
    return { kind: "forbidden" };
  }
  return { kind: "ok" };
};

export { constantTimeEqual, readBearerToken, verifyInternalSecret };
export type { VerifyResult };
