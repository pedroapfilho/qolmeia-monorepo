import { Card, CardContent } from "@repo/ui/components/card";
import { cn } from "@repo/ui/lib/utils";
import type { Metadata } from "next";

import { apiGetServer } from "@/lib/api-server";
import type { Paginated, RunRow } from "@/lib/api-types";
import { formatBRL, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Execuções" };

const statusBadge = (status: RunRow["status"]) => {
  if (status === "SUCCEEDED") {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  if (status === "FAILED") {
    return "bg-destructive/10 text-destructive";
  }
  return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
};

const RunsPage = async () => {
  const res = await apiGetServer<Paginated<RunRow>>("/runs?limit=20");
  const runs = res.items;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Execuções</h1>
        <p className="text-sm text-muted-foreground">
          Histórico das execuções dos agentes — status, início e custo.
        </p>
      </header>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma execução registrada ainda.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0">
            <ul className="flex flex-col">
              {runs.map((run) => (
                <li
                  className="flex items-center justify-between gap-4 border-b border-border px-6 py-4 last:border-b-0"
                  key={run.id}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{run.id}</span>
                    <time className="text-xs text-muted-foreground" dateTime={run.startedAt}>
                      {formatDateTime(run.startedAt)}
                    </time>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatBRL(run.costCents)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        statusBadge(run.status),
                      )}
                    >
                      {run.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* TODO: run detail page — POST tree + cost breakdown. */}
    </div>
  );
};

export default RunsPage;
