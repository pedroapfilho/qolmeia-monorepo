import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

const TONE: Record<StatusTone, { dot: string; pill: string }> = {
  danger: {
    dot: "bg-destructive",
    pill: "bg-destructive-surface text-destructive-surface-foreground",
  },
  info: { dot: "bg-info", pill: "bg-info-surface text-info-surface-foreground" },
  neutral: { dot: "bg-muted-foreground/60", pill: "bg-muted text-muted-foreground" },
  success: { dot: "bg-success", pill: "bg-success-surface text-success-surface-foreground" },
  warning: { dot: "bg-warning", pill: "bg-warning-surface text-warning-surface-foreground" },
};

type StatusPillProps = ComponentProps<"span"> & {
  dotless?: boolean;
  label: string;
  pulse?: boolean;
  tone: StatusTone;
};

const StatusPill = ({ className, dotless, label, pulse, tone, ...props }: StatusPillProps) => {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        t.pill,
        className,
      )}
      {...props}
    >
      {dotless ? null : (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            t.dot,
            pulse && "motion-safe:animate-qpulse",
          )}
        />
      )}
      {label}
    </span>
  );
};

export { StatusPill };
export type { StatusTone };
