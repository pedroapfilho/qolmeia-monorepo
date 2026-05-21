import { cn } from "@repo/ui/lib/utils";

import type { ActivityLogType, ActivityRow as ActivityRowType } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";

// Map each ActivityLogType to a colour family. The categories track the
// system's coarse pillars (run lifecycle / action lifecycle / budget /
// owner) so the eye can scan the timeline by hue.
const TYPE_CATEGORY: Record<ActivityLogType, "run" | "action" | "budget" | "owner" | "neutral"> = {
  ACTION_APPROVED: "action",
  ACTION_DRAFTED: "action",
  ACTION_EXECUTED: "action",
  ACTION_FAILED: "action",
  ACTION_REJECTED: "action",
  AGENT_RUN_FAILED: "run",
  AGENT_RUN_FINISHED: "run",
  AGENT_RUN_STARTED: "run",
  BUDGET_WARN_100: "budget",
  BUDGET_WARN_80: "budget",
  BUSINESS_IDEA_UPDATED: "owner",
  INSTRUCTIONS_UPDATED: "owner",
  MEMBER_INVITED: "neutral",
  MEMBER_JOINED: "neutral",
  MESSAGE_INBOUND: "neutral",
  MESSAGE_OUTBOUND: "neutral",
  OWNER_COMMAND: "owner",
  ROUTINE_DISABLED: "neutral",
  ROUTINE_ENABLED: "neutral",
  ROUTINE_TRIGGERED: "neutral",
};

const CATEGORY_CLASSES: Record<(typeof TYPE_CATEGORY)[ActivityLogType], string> = {
  action: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  budget: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  neutral: "bg-muted text-muted-foreground",
  owner: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  run: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

type ActivityRowProps = {
  row: ActivityRowType;
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
  const category = TYPE_CATEGORY[row.type] ?? "neutral";
  const pillClass = CATEGORY_CLASSES[category];

  return (
    <li className="flex flex-col gap-2 border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            pillClass,
          )}
        >
          {row.type}
        </span>
        <time className="text-xs text-muted-foreground" dateTime={row.createdAt}>
          {formatRelative(row.createdAt)}
        </time>
      </div>
      <p className="text-sm text-foreground">{row.summary}</p>
      {hasPayload(row.payload) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">payload</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
};

export { ActivityRow };
