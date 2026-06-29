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

export { constantTimeEqual };
