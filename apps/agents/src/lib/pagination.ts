const parsePositiveInt = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

const parseTimestamp = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
};

export { parsePositiveInt, parseTimestamp };
