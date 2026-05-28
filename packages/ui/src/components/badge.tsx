import { cn } from "@repo/ui/lib/utils";
import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "success" | "warning" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-foreground/10 text-foreground",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  muted: "bg-muted text-muted-foreground",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
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
