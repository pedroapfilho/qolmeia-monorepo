import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createElement } from "react";

import { getActionRenderer } from "@/components/action-renderers";
import { BackLink } from "@/components/back-link";
import { DecisionForm } from "@/components/decision-form";
import { StatusPill } from "@/components/status-pill";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { ActionDetailResponse } from "@/lib/api-types";
import { formatDateTime, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Revisar aprovação" };

type ApprovalDetailPageProps = {
  params: Promise<{ id: string }>;
};

const POLICY_COPY: Record<string, string> = {
  "auto-execute": "Execução automática",
  "notify-only": "Apenas notificar",
  "require-approval": "Sob aprovação",
};

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

  const { action, ticket } = detail;
  const summary = typeof action.proposed.summary === "string" ? action.proposed.summary : null;
  const policyCopy = POLICY_COPY[action.policy] ?? action.policy;
  const TypedRenderer = getActionRenderer(action.actionType);

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/approvals">Voltar para aprovações</BackLink>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {action.actionType}
          </h1>
          <StatusPill status={action.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {policyCopy} · {formatRelative(action.createdAt)} ·{" "}
          <span className="text-foreground/60">criado em {formatDateTime(action.createdAt)}</span>
        </p>
      </header>

      {ticket && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ticket de origem</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="font-mono text-sm font-medium text-primary transition-colors hover:text-primary/80"
                href={`/tickets/${ticket.id}`}
              >
                {ticket.id}
              </Link>
              <StatusPill status={ticket.status} />
            </div>
            <p className="text-sm leading-relaxed text-foreground">{ticket.brief}</p>
          </CardContent>
        </Card>
      )}

      {TypedRenderer && createElement(TypedRenderer, { proposed: action.proposed })}

      <Card>
        <CardHeader>
          <CardTitle>Proposta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {summary && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{summary}</p>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer text-sm font-medium text-foreground/80 transition-colors select-none hover:text-foreground">
              Ver proposta completa (JSON)
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {JSON.stringify(action.proposed, null, 2)}
            </pre>
          </details>
        </CardContent>
      </Card>

      {action.status === "pending" ? (
        <Card>
          <CardHeader>
            <CardTitle>Decisão</CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionForm actionId={action.id} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Decidido</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
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
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                {action.feedback}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ApprovalDetailPage;
