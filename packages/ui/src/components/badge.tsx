import { cn } from "@repo/ui/lib/utils";
import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "success" | "warning" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-foreground/10 text-foreground",
  info: "bg-info-surface text-info-surface-foreground",
  muted: "bg-muted text-muted-foreground",
  success: "bg-success-surface text-success-surface-foreground",
  warning: "bg-warning-surface text-warning-surface-foreground",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const Badge = ({ className, variant = "default", ...rest }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      VARIANT_CLASSES[variant],
      className,
    )}
    {...rest}
  />
);

export { Badge };
export type { BadgeProps, BadgeVariant };
