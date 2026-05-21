import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { cn } from "@repo/ui/lib/utils";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { AgentDetail } from "@/lib/api-types";
import { formatBRL, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Agente" };

const statusBadge = (status: AgentDetail["status"]) => {
  if (status === "ACTIVE") {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  return "bg-muted text-muted-foreground";
};

type AgentPageProps = {
  params: Promise<{ id: string }>;
};

const AgentPage = async ({ params }: AgentPageProps) => {
  const { id } = await params;

  let agent: AgentDetail;
  try {
    agent = await apiGetServer<AgentDetail>(`/agents/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        href="/agents"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Voltar para agentes
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{agent.displayName}</h1>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              statusBadge(agent.status),
            )}
          >
            {agent.status === "ACTIVE" ? "Ativo" : "Pausado"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Template {agent.template.displayName} ({agent.templateSlug})
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Missão</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{agent.mission}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Orçamento</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(agent.budgetCents)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Skills</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{agent.skillCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Execuções recentes</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {agent.recentRuns.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">Nenhuma execução ainda.</p>
          ) : (
            <ul className="flex flex-col">
              {agent.recentRuns.map((run) => (
                <li
                  className="flex items-center justify-between border-b border-border px-6 py-3 last:border-b-0"
                  key={run.id}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{run.id}</span>
                    <time className="text-xs text-muted-foreground" dateTime={run.startedAt}>
                      {formatDateTime(run.startedAt)}
                    </time>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatBRL(run.costCents)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {run.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* TODO: PATCH form (mission + budgetCents + status) — owner-supplied UX decision */}
    </div>
  );
};

export default AgentPage;
