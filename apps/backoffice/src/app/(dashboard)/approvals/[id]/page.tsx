import { Card } from "@repo/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createElement } from "react";

import { getActionRenderer } from "@/components/action-renderers";
import { BackLink } from "@/components/back-link";
import { DecisionForm } from "@/components/decision-form";
import { StatusPill } from "@/components/status-pill";
import { agentAvatarClass, agentInitials } from "@/lib/agent-avatar";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { ActionDetailResponse } from "@/lib/api-types";
import {
  actionTypeLabel,
  formatDateTime,
  formatDurationSeconds,
  formatRelative,
} from "@/lib/format";

export const metadata: Metadata = { title: "Revisar aprovação" };

type ApprovalDetailPageProps = {
  params: Promise<{ id: string }>;
};

const POLICY_COPY: Record<string, string> = {
  "auto-execute": "Execução automática",
  "notify-only": "Apenas notificar",
  "require-approval": "Sob aprovação",
};

/**
 * Authenticated detail surface bound to `params` and the per-request session;
 * block rather than stream a shell.
 * @public Next.js app-router reads the `instant` route config via the module loader
 */
export const instant = false;

const ApprovalDetailPage = async ({ params }: ApprovalDetailPageProps) => {
  const { id } = await params;

  let detail: ActionDetailResponse | null = null;
  try {
    detail = await apiGetServer<ActionDetailResponse>(`/actions/${id}`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }
  if (!detail) {
    notFound();
  }

  const { action, ageSeconds, ticket } = detail;
  const summary = typeof action.proposed.summary === "string" ? action.proposed.summary : null;
  const policyCopy = POLICY_COPY[action.policy] ?? action.policy;
  const TypedRenderer = getActionRenderer(action.actionType);
  const waited = formatDurationSeconds(Math.max(0, ageSeconds));

  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/approvals">Aprovações</BackLink>

      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-[26px]">
              Revisar ação
            </h1>
            <span className="font-mono text-xs text-muted-foreground">{action.id}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {actionTypeLabel(action.actionType)}
            </span>{" "}
            · {policyCopy} · {formatRelative(action.createdAt)}
          </p>
        </div>
        <StatusPill status={action.status} />
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col gap-4">
          {TypedRenderer ? (
            createElement(TypedRenderer, { proposed: action.proposed })
          ) : (
            <Card className="gap-4 p-5">
              <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Proposta
              </span>
              {summary && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                  {summary}
                </p>
              )}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer text-sm font-medium text-foreground/80 transition-colors select-none hover:text-foreground">
                  Ver proposta completa (JSON)
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-border bg-secondary/40 p-3 text-xs">
                  {JSON.stringify(action.proposed, null, 2)}
                </pre>
              </details>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="gap-3 p-5">
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              Contexto
            </span>
            <dl className="flex flex-col gap-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Empresa</dt>
                <dd className="truncate font-medium text-foreground">{action.companyName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Agente</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`flex size-5 flex-none items-center justify-center rounded-lg text-[9px] font-bold text-white ${agentAvatarClass(action.agent.role, action.agent.workerKind)}`}
                  >
                    {agentInitials(action.agent.name)}
                  </span>
                  <span className="truncate font-medium text-foreground">{action.agent.name}</span>
                </dd>
              </div>
              {ticket && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Ticket</dt>
                  <dd>
                    <Link
                      className="font-mono text-xs text-primary transition-colors hover:text-primary/80"
                      href={`/tickets/${ticket.id}`}
                    >
                      {ticket.id}
                    </Link>
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Aguardando</dt>
                <dd className="font-medium text-foreground">{waited}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Política</dt>
                <dd className="font-medium text-foreground">{policyCopy}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Criado</dt>
                <dd className="font-medium text-foreground">{formatDateTime(action.createdAt)}</dd>
              </div>
            </dl>
            {ticket && (
              <p className="border-t border-border/60 pt-3 text-sm leading-relaxed text-muted-foreground">
                {ticket.brief}
              </p>
            )}
          </Card>

          {action.status === "pending" ? (
            <Card className="gap-3 p-5">
              <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Decisão
              </span>
              <DecisionForm actionId={action.id} />
            </Card>
          ) : (
            <Card className="gap-3 p-5">
              <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Decidido
              </span>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status final:</span>
                <StatusPill status={action.status} />
              </div>
              {action.decidedAt && (
                <p className="text-xs text-muted-foreground">
                  Decisão em {formatDateTime(action.decidedAt)}
                  {action.decidedByUserId ? ` por ${action.decidedByUserId}` : ""}
                </p>
              )}
              {action.feedback && (
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                  {action.feedback}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApprovalDetailPage;
