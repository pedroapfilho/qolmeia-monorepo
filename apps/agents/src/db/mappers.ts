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
