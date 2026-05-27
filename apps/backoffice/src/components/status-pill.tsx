import { cn } from "@repo/ui/lib/utils";

import type { ActionStatus, TicketStatus } from "@/lib/api-types";

type StatusKind = ActionStatus | TicketStatus;

type Tone = "emerald" | "amber" | "blue" | "rose" | "sky" | "neutral";

const STATUS_COPY: Record<StatusKind, string> = {
  approved: "Aprovado",
  awaiting_approval: "Aguardando aprovação",
  blocked: "Bloqueado",
  cancelled: "Cancelado",
  changes_requested: "Mudanças pedidas",
  done: "Concluído",
  executed: "Executado",
  in_progress: "Em andamento",
  open: "Aberto",
  pending: "Pendente",
  rejected: "Rejeitado",
};

const STATUS_TONE: Record<StatusKind, Tone> = {
  approved: "emerald",
  awaiting_approval: "amber",
  blocked: "rose",
  cancelled: "neutral",
  changes_requested: "amber",
  done: "emerald",
  executed: "emerald",
  in_progress: "blue",
  open: "sky",
  pending: "amber",
  rejected: "rose",
};

const TONE_CLASSES: Record<Tone, string> = {
  amber:
    "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20",
  neutral: "bg-muted text-muted-foreground ring-border",
  rose: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-400/20",
};

const DOT_CLASSES: Record<Tone, string> = {
  amber: "bg-amber-500 dark:bg-amber-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  neutral: "bg-muted-foreground/60",
  rose: "bg-rose-500 dark:bg-rose-400",
  sky: "bg-sky-500 dark:bg-sky-400",
};

type StatusPillProps = {
  className?: string;
  status: StatusKind;
};

const StatusPill = ({ className, status }: StatusPillProps) => {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASSES[tone])} />
      {STATUS_COPY[status]}
    </span>
  );
};

export { StatusPill };
