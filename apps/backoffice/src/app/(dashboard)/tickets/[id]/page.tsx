import { Card, CardContent } from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BackLink } from "@/components/back-link";
import { StatusPill } from "@/components/status-pill";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { Action, TicketDetailResponse } from "@/lib/api-types";
import { formatRelative, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Ticket" };

type TicketDetailPageProps = {
  params: Promise<{ id: string }>;
};

type StepTone = "done" | "current" | "waiting" | "blocked";

const STEP_TONE: Record<Action["status"], StepTone> = {
  approved: "current",
  changes_requested: "waiting",
  executed: "done",
  pending: "waiting",
  rejected: "blocked",
};

const STEP_DOT: Record<StepTone, string> = {
  blocked: "border-destructive bg-destructive",
  current: "border-info bg-info",
  done: "border-success bg-success",
  waiting: "border-warning bg-warning",
};

const TicketDetailContent = async ({ params }: TicketDetailPageProps) => {
  const { id } = await params;

  let detail: TicketDetailResponse | null = null;
  try {
    detail = await apiGetServer<TicketDetailResponse>(`/tickets/${id}`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }
  if (!detail) {
    notFound();
  }

  const { actions, ticket } = detail;
  const relatedAction = actions.at(0) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/tickets">Tickets</BackLink>

      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 font-mono text-xs text-muted-foreground">{ticket.id}</div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {truncate(ticket.brief, 80)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{ticket.companyId}</span>
            <span aria-hidden>·</span>
            <span>{ticket.agentInstanceId}</span>
          </div>
        </div>
        <StatusPill status={ticket.status} />
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent>
              <div className="mb-4 text-sm font-bold text-foreground">Execução</div>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma etapa registrada neste ticket ainda.
                </p>
              ) : (
                <ol className="flex flex-col">
                  {actions.map((action, index) => {
                    const tone = STEP_TONE[action.status];
                    const isLast = index === actions.length - 1;
                    const summary =
                      typeof action.proposed.summary === "string"
                        ? action.proposed.summary
                        : action.actionType;
                    return (
                      <li className="flex gap-3.5" key={action.id}>
                        <div className="flex flex-col items-center">
                          <span
                            aria-hidden
                            className={cn("size-4 shrink-0 rounded-full border-2", STEP_DOT[tone])}
                          />
                          {!isLast && <span className="min-h-[18px] w-0.5 flex-1 bg-border" />}
                        </div>
                        <div className={cn("pb-4", isLast && "pb-0")}>
                          <div className="text-sm leading-snug font-medium text-foreground">
                            {truncate(summary, 120)}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                            {formatRelative(action.createdAt)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3.5 text-sm font-bold text-foreground">
              Entregável
            </div>
            {ticket.result ? (
              <pre className="max-h-96 overflow-auto bg-muted/40 p-4 text-xs leading-relaxed text-foreground">
                {JSON.stringify(ticket.result, null, 2)}
              </pre>
            ) : (
              <div className="flex h-40 items-center justify-center bg-muted/40">
                <span className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                  aguardando entrega
                </span>
              </div>
            )}
            <div className="px-5 py-3.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {ticket.brief}
            </div>
          </Card>
        </div>

        <Card>
          <CardContent>
            <div className="mb-3 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              Detalhes
            </div>
            <div className="flex flex-col gap-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Empresa</span>
                <span className="truncate font-semibold text-foreground">{ticket.companyId}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Agente</span>
                <span className="truncate font-semibold text-foreground">
                  {ticket.agentInstanceId}
                </span>
              </div>
              {relatedAction && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Tipo</span>
                  <span className="truncate font-semibold text-foreground">
                    {relatedAction.actionType}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Workflow</span>
                <span className="truncate font-mono text-xs font-semibold text-foreground">
                  {ticket.workflowId ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <StatusPill status={ticket.status} />
              </div>
            </div>

            {relatedAction && (
              <div className="mt-4 border-t border-border pt-3.5">
                <div className="mb-2 text-xs text-muted-foreground">Ação relacionada</div>
                <Link
                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                  href={`/approvals/${relatedAction.id}`}
                >
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                    {relatedAction.actionType}
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Static shell for the prerender: the detail is bound to `params` and the
// per-request session, so cacheComponents needs a Suspense boundary above it.
const TicketDetailSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <Skeleton className="h-4 w-24" />
    <Skeleton className="h-8 w-72" />
    <Skeleton className="h-48 w-full" />
    <Skeleton className="h-48 w-full" />
  </div>
);

const TicketDetailPage = (props: TicketDetailPageProps) => (
  <Suspense fallback={<TicketDetailSkeleton />}>
    <TicketDetailContent {...props} />
  </Suspense>
);

export default TicketDetailPage;
