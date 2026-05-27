import type { ReactNode } from "react";

import { cn } from "../lib/utils";

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

const PageHeader = ({ actions, className, description, eyebrow, title }: PageHeaderProps) => (
  <header className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6", className)}>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {eyebrow ? (
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {eyebrow}
        </span>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </header>
);

export { PageHeader };
