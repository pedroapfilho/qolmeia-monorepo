import { cn } from "@repo/ui/lib/utils";

import type { ActivityEntry } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";

type Category = "action" | "neutral" | "team" | "ticket";

const categoriseType = (type: string): Category => {
  if (type.startsWith("ACTION_")) {
    return "action";
  }
  if (type.startsWith("TICKET_") || type.startsWith("WORKER_")) {
    return "ticket";
  }
  if (type.startsWith("TEAM_") || type.startsWith("MEMBER_")) {
    return "team";
  }
  return "neutral";
};

const CATEGORY_CLASSES: Record<Category, string> = {
  action: "bg-info-surface text-info-surface-foreground ring-info/20",
  neutral: "bg-muted text-muted-foreground ring-border",
  team: "bg-highlight-surface text-highlight-surface-foreground ring-highlight/20",
  ticket: "bg-success-surface text-success-surface-foreground ring-success/20",
};

type ActivityRowProps = {
  row: ActivityEntry;
};

const hasPayload = (payload: unknown): boolean => {
  if (payload === null || payload === undefined) {
    return false;
  }
  if (typeof payload !== "object") {
    return true;
  }
  return Object.keys(payload as Record<string, unknown>).length > 0;
};

const ActivityRow = ({ row }: ActivityRowProps) => {
  const category = categoriseType(row.type);
  const pillClass = CATEGORY_CLASSES[category];

  return (
    <li className="flex flex-col gap-2 border-b border-border px-6 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-tight ring-1 ring-inset",
            pillClass,
          )}
        >
          {row.type}
        </span>
        <time className="text-xs text-muted-foreground">{formatRelative(row.createdAt)}</time>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{row.summary}</p>
      {hasPayload(row.payload) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-xs font-medium select-none hover:text-foreground">
            Ver payload
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
};

export { ActivityRow };
