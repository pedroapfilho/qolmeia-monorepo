import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { StatusPill } from "@/components/status-pill";
import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { TicketDetailResponse } from "@/lib/api-types";
import { formatRelative, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Ticket" };

type TicketDetailPageProps = {
  params: Promise<{ id: string }>;
};

const TicketDetailPage = async ({ params }: TicketDetailPageProps) => {
  const { id } = await params;

  let detail: TicketDetailResponse;
  try {
    detail = await apiGetServer<TicketDetailResponse>(`/tickets/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const { actions, ticket } = detail;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/tickets">Voltar para tickets</BackLink>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {ticket.id}
          </h1>
          <StatusPill status={ticket.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Especialista:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {ticket.agentInstanceId}
          </code>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Briefing</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {ticket.brief}
          </p>
        </CardContent>
      </Card>

      {ticket.result && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {JSON.stringify(ticket.result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ações</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {actions.length === 0 ? (
            <p className="px-6 pb-2 text-sm text-muted-foreground">
              Nenhuma ação proposta neste ticket ainda.
            </p>
          ) : (
            <ul className="flex flex-col">
              {actions.map((action) => {
                const summary =
                  typeof action.proposed.summary === "string" ? action.proposed.summary : null;
                return (
                  <li
                    className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 last:border-b-0"
                    key={action.id}
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className="text-sm font-medium text-foreground transition-colors hover:text-primary"
                          href={`/approvals/${action.id}`}
                        >
                          {action.actionType}
                        </Link>
                        <StatusPill status={action.status} />
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(action.createdAt)}
                        </span>
                      </div>
                      {summary ? (
                        <p className="text-sm text-muted-foreground">{truncate(summary, 220)}</p>
                      ) : null}
                    </div>
                    <Link
                      aria-label={`Abrir ação ${action.actionType}`}
                      className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      href={`/approvals/${action.id}`}
                    >
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TicketDetailPage;
