import type { ReactNode } from "react";

import { cn } from "../lib/utils";

type EmptyStateProps = {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
};

const EmptyState = ({ action, className, description, icon, title }: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
      className,
    )}
  >
    {icon !== undefined && icon !== null ? (
      <div
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5"
      >
        {icon}
      </div>
    ) : null}
    {title !== undefined && title !== null ? (
      <p className="text-sm font-medium text-foreground">{title}</p>
    ) : null}
    {description !== undefined && description !== null ? (
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    ) : null}
    {action !== undefined && action !== null ? <div className="pt-2">{action}</div> : null}
  </div>
);

export { EmptyState };
