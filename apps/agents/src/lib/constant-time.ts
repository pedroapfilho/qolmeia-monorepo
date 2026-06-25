// Constant-time string comparison. Guards INTERNAL_SHARED_SECRET (internal.ts)
// against timing attacks: a `===`/`!==` compare short-circuits on the first
// differing byte,
// leaking how many leading bytes matched and letting an attacker recover the
// secret byte-by-byte. This XOR-accumulator never short-circuits — it folds a
// length difference into the accumulator and walks a fixed number of bytes so
// the work (and timing) does not depend on where, or whether, the inputs differ.
const constantTimeEqual = (a: string, b: string): boolean => {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Seed the accumulator with the length delta so unequal lengths can never
  // return true, while still comparing over a fixed span (the longer input)
  // rather than returning early on the length mismatch.
  let diff = aBytes.length ^ bBytes.length;
  const max = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < max; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
};

export { constantTimeEqual };
