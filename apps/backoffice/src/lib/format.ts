const RTF = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const DATE_SHORT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

const formatRelative = (epochMs: number, now: Date = new Date()): string => {
  const then = new Date(epochMs);
  if (Number.isNaN(then.getTime())) {
    return String(epochMs);
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
  return DATE_SHORT.format(then);
};

const formatDateTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return String(epochMs);
  }
  return DATE_TIME.format(date);
};

const formatDurationSeconds = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h${rem}min`;
};

const truncate = (value: string, limit = 120): string => {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1).trimEnd()}…`;
};

const ACTION_TYPE_LABEL = {
  publish_post: "Publicar post",
  send_collection_message: "Enviar cobrança",
  worker_deliverable: "Entrega",
} satisfies Record<string, string>;
const actionTypeLabelById = new Map<string, string>(Object.entries(ACTION_TYPE_LABEL));

const actionTypeLabel = (actionType: string): string => {
  const known = actionTypeLabelById.get(actionType);
  if (known !== undefined && known !== "") {
    return known;
  }
  const pretty = actionType.replaceAll(/[_\-]+/gv, " ").trim();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
};

type AgeTier = "calm" | "urgent" | "warning";

const ageTier = (seconds: number | undefined): AgeTier => {
  if (seconds === undefined || seconds < 3600) {
    return "calm";
  }
  return seconds >= 4 * 3600 ? "urgent" : "warning";
};

export {
  actionTypeLabel,
  ageTier,
  formatDateTime,
  formatDurationSeconds,
  formatRelative,
  truncate,
};
export type { AgeTier };
