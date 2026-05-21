// Locale-bound formatters. Centralised so currency/relative-time rules
// don't drift across pages.

const brl = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

const formatBRL = (cents: number): string => brl.format(cents / 100);

const RTF = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

// Returns a pt-BR relative-time string ("há 2 min", "ontem"). Falls back
// to the absolute date when the gap exceeds ~30 days — relative time gets
// noisy past that threshold.
const formatRelative = (iso: string, now: Date = new Date()): string => {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    return iso;
  }
  const diffMs = then.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return "agora";
  }
  if (Math.abs(diffMin) < 60) {
    return RTF.format(diffMin, "minute");
  }
  const diffHour = Math.round(diffMs / 3_600_000);
  if (Math.abs(diffHour) < 24) {
    return RTF.format(diffHour, "hour");
  }
  const diffDay = Math.round(diffMs / 86_400_000);
  if (Math.abs(diffDay) < 30) {
    return RTF.format(diffDay, "day");
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(then);
};

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const truncate = (value: string, limit = 120): string => {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1).trimEnd()}…`;
};

export { formatBRL, formatDateTime, formatRelative, truncate };
