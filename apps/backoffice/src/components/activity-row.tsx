import { cn } from "@repo/ui/lib/utils";

import type { ActivityEntry } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";

type Category = "action" | "member" | "neutral" | "team" | "ticket" | "worker";

const categoriseType = (type: string): Category => {
  if (type.startsWith("ACTION_")) {
    return "action";
  }
  if (type.startsWith("TICKET_")) {
    return "ticket";
  }
  if (type.startsWith("WORKER_")) {
    return "worker";
  }
  if (type.startsWith("TEAM_")) {
    return "team";
  }
  if (type.startsWith("MEMBER_")) {
    return "member";
  }
  return "neutral";
};

const CATEGORY_CLASSES: Record<Category, string> = {
  action: "bg-highlight-surface text-highlight-surface-foreground",
  member: "bg-destructive-surface text-destructive-surface-foreground",
  neutral: "bg-muted text-muted-foreground",
  team: "bg-success-surface text-success-surface-foreground",
  ticket: "bg-info-surface text-info-surface-foreground",
  worker: "bg-cyan-surface text-cyan-surface-foreground",
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
  const tagClass = CATEGORY_CLASSES[category];

  return (
    <li className="flex flex-col gap-2 border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex items-center gap-3.5">
        <span
          className={cn(
            "inline-flex w-[188px] shrink-0 items-center overflow-hidden rounded-md px-2 py-1 font-mono text-[10.5px] font-medium tracking-tight text-ellipsis whitespace-nowrap",
            tagClass,
          )}
          title={row.type}
        >
          {row.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.summary}</span>
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {row.companyName}
        </span>
        <time className="w-[54px] shrink-0 text-right font-mono text-[11px] whitespace-nowrap text-muted-foreground/80">
          {formatRelative(row.createdAt)}
        </time>
      </div>
      {hasPayload(row.payload) && (
        <details className="pl-[202px] text-xs text-muted-foreground">
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
