// Given a desired base name (e.g. the template's display_name) and the
// existing team's display names, return the lowest-suffix name that doesn't
// collide. Base if free, else "Base #2", "Base #3", ...

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
