import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import { buttonVariants } from "@repo/ui/lib/button-variants";
import { cn } from "@repo/ui/lib/utils";
import type { ActionsResponse } from "@repo/worker-api/contracts";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { agentAvatarClass, agentInitials } from "@/lib/agent-avatar";
import { apiGetServer } from "@/lib/api-server";
import {
  actionTypeLabel,
  type AgeTier,
  ageTier,
  formatDurationSeconds,
  truncate,
} from "@/lib/format";

export const metadata: Metadata = { title: "Aprovações" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const AGE_TIER_CLASS = {
  calm: "text-muted-foreground",
  urgent: "font-semibold text-destructive-surface-foreground",
  warning: "font-semibold text-warning-surface-foreground",
} satisfies Record<AgeTier, string>;

const proposedSummary = (proposed: ActionsResponse["items"][number]["proposed"]): string => {
  const summary = typeof proposed.summary === "string" ? proposed.summary : "";
  return summary.split("\n")[0]?.trim() ?? "";
};

const ApprovalsContent = async () => {
  const res = await apiGetServer<ActionsResponse>("/actions?status=pending&sort=age");
  const pendingCount = res.items.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          pendingCount > 0 ? (
            <span className="rounded-full bg-warning-surface px-3 py-1.5 text-sm font-semibold text-warning-surface-foreground">
              {pendingCount} pendentes
            </span>
          ) : null
        }
        description="Ações propostas pelos especialistas aguardando uma decisão, mais antigas primeiro."
        title="Aprovações"
      />

      <Card className="gap-0 overflow-hidden py-0">
        {pendingCount === 0 ? (
          <EmptyState
            className="py-12"
            description="Os agentes estão executando livremente. Quando algo precisar do seu olho, aparece aqui."
            icon={<Inbox aria-hidden />}
            title="Sem nada na fila"
          />
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_180px_150px_110px_92px] items-center gap-3 border-b border-border bg-secondary/40 px-5 py-3 font-mono text-xs tracking-wide text-muted-foreground uppercase">
              <span>Ação</span>
              <span>Empresa</span>
              <span>Agente</span>
              <span>Aguardando</span>
              <span />
            </div>
            <ul className="flex flex-col">
              {res.items.map((action) => {
                const preview = proposedSummary(action.proposed);
                return (
                  <li
                    className="grid grid-cols-[1fr_180px_150px_110px_92px] items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-b-0"
                    key={action.id}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {actionTypeLabel(action.actionType)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {preview ? (
                            truncate(preview, 72)
                          ) : (
                            <span className="font-mono">{action.id}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="truncate text-sm text-muted-foreground">
                      {action.companyName}
                    </span>
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${agentAvatarClass(action.agent.role, action.agent.workerKind)}`}
                      >
                        {agentInitials(action.agent.name)}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {action.agent.name}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        AGE_TIER_CLASS[ageTier(action.ageSeconds)],
                      )}
                    >
                      {action.ageSeconds === undefined
                        ? "—"
                        : formatDurationSeconds(action.ageSeconds)}
                    </span>
                    <Link
                      className={buttonVariants({ className: "w-full", size: "sm" })}
                      href={`/approvals/${action.id}`}
                    >
                      Revisar
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
};

const ApprovalsSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <PageHeader
      description="Ações propostas pelos especialistas aguardando uma decisão, mais antigas primeiro."
      title="Aprovações"
    />
    <Card className="flex flex-col gap-4 p-6">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </Card>
  </div>
);

const ApprovalsPage = () => (
  <Suspense fallback={<ApprovalsSkeleton />}>
    <ApprovalsContent />
  </Suspense>
);

export default ApprovalsPage;
