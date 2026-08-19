import { cn } from "@repo/ui/lib/utils";
import type { ActionStatus, TicketStatus } from "@repo/worker-api/contracts";

type StatusKind = ActionStatus | TicketStatus;

type Tone = "success" | "warning" | "info" | "danger" | "neutral";

const STATUS_COPY = {
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
} satisfies Record<StatusKind, string>;

const STATUS_TONE = {
  approved: "success",
  awaiting_approval: "warning",
  blocked: "danger",
  cancelled: "neutral",
  changes_requested: "warning",
  done: "success",
  executed: "success",
  in_progress: "info",
  open: "info",
  pending: "warning",
  rejected: "danger",
} satisfies Record<StatusKind, Tone>;

const TONE_CLASSES = {
  danger: "bg-destructive-surface text-destructive-surface-foreground ring-destructive/20",
  info: "bg-info-surface text-info-surface-foreground ring-info/20",
  neutral: "bg-muted text-muted-foreground ring-border",
  success: "bg-success-surface text-success-surface-foreground ring-success/20",
  warning: "bg-warning-surface text-warning-surface-foreground ring-warning/20",
} satisfies Record<Tone, string>;

const DOT_CLASSES = {
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
} satisfies Record<Tone, string>;

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
