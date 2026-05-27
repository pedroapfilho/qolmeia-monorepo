// Shared row-mapping primitives.
//
// `safeJson` is the single helper for "parse a TEXT column that holds JSON,
// or fall back to a typed default." It was open-coded in five places (one
// per table mapper + once per route that bypassed the mapper); consolidating
// here is the seam the action-casing leak from P7 proved out — every route
// now reads through the same parser.
//
// `safeJson<T>(value, fallback)` is the only function this file exports.
// Per-table row → typed shape mappers (mapAction, mapTicket, mapTemplate)
// stay next to their row type, but they all call this helper.
const safeJson = <T>(value: string | null, fallback: T): T => {
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export { safeJson };
