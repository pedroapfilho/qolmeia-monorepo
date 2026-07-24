const safeJson = <T>(value: string | null, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    // oxlint-disable-next-line no-unsafe-type-assertion -- D1 JSON columns written by this module; shape is trusted and callers fall back on parse failure
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toEnum =
  <T extends string>(values: ReadonlyArray<T>, fallback: T) =>
  (raw: string): T =>
    values.find((value) => value === raw) ?? fallback;

export { safeJson, toEnum };
