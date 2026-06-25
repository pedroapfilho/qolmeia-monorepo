const normalize = (s: string): string => s.toLocaleLowerCase("pt-BR");

const nextDisplayName = (base: string, existing: ReadonlyArray<string>): string => {
  const taken = new Set(existing.map(normalize));
  if (!taken.has(normalize(base))) {
    return base;
  }
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} #${n}`;
    if (!taken.has(normalize(candidate))) {
      return candidate;
    }
  }
  throw new Error(`nextDisplayName: exhausted candidates for "${base}"`);
};

export { nextDisplayName };
