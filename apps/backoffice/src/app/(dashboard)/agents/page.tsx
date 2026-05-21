import { Card, CardContent } from "@repo/ui/components/card";
import { cn } from "@repo/ui/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";

import { apiGetServer } from "@/lib/api-server";
import type { AgentSummary, Paginated } from "@/lib/api-types";
import { formatBRL, formatRelative, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Agentes" };

const statusBadge = (status: AgentSummary["status"]) => {
  if (status === "ACTIVE") {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  return "bg-muted text-muted-foreground";
};

const AgentsPage = async () => {
  const res = await apiGetServer<Paginated<AgentSummary>>("/agents");
  const agents = res.items;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Agentes</h1>
        <p className="text-sm text-muted-foreground">
          Agentes ativos da sua organização, com missão, orçamento e última execução.
        </p>
      </header>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum agente cadastrado ainda.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold tracking-tight">{agent.displayName}</h2>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          statusBadge(agent.status),
                        )}
                      >
                        {agent.status === "ACTIVE" ? "Ativo" : "Pausado"}
                      </span>
                    </div>
                    <Link
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      href={`/agents/${agent.id}`}
                    >
                      Editar
                    </Link>
                  </div>
                  <p className="text-sm text-muted-foreground">{truncate(agent.mission, 200)}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Template</dt>
                      <dd className="font-medium">{agent.template.displayName}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Orçamento</dt>
                      <dd className="font-medium tabular-nums">{formatBRL(agent.budgetCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Skills</dt>
                      <dd className="font-medium tabular-nums">{agent.skillCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Última execução</dt>
                      <dd className="font-medium">
                        {agent.lastRunAt ? formatRelative(agent.lastRunAt) : "—"}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AgentsPage;
