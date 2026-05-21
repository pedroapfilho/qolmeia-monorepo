import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import type { Metadata } from "next";
import Link from "next/link";

import { ActivityRow } from "@/components/activity-row";
import { apiGetServer } from "@/lib/api-server";
import type {
  ActivityRow as ActivityRowType,
  AgentSummary,
  ApprovalRow,
  Paginated,
} from "@/lib/api-types";

export const metadata: Metadata = { title: "Início" };

const Home = async () => {
  // Parallel fetch — Promise.allSettled so a transient failure on one
  // endpoint doesn't blank the entire dashboard.
  const [approvalsRes, agentsRes, activityRes] = await Promise.allSettled([
    apiGetServer<Paginated<ApprovalRow>>("/approvals?limit=20"),
    apiGetServer<Paginated<AgentSummary>>("/agents"),
    apiGetServer<Paginated<ActivityRowType>>("/activity?limit=5"),
  ]);

  const approvals = approvalsRes.status === "fulfilled" ? approvalsRes.value.items : [];
  const agents = agentsRes.status === "fulfilled" ? agentsRes.value.items : [];
  const activity = activityRes.status === "fulfilled" ? activityRes.value.items : [];

  const activeAgents = agents.filter((a) => a.status === "ACTIVE").length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Início</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral das aprovações, agentes e atividade recente.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aprovações pendentes
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <p className="text-4xl font-semibold tracking-tight">{approvals.length}</p>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="/approvals"
            >
              Ver aprovações
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Agentes ativos
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <p className="text-4xl font-semibold tracking-tight">
              {activeAgents}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                / {agents.length}
              </span>
            </p>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="/agents"
            >
              Ver agentes
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Eventos recentes</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {activity.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">
              Nada para mostrar ainda. Quando os agentes começarem a executar ações, os eventos
              aparecem aqui.
            </p>
          ) : (
            <ul className="flex flex-col">
              {activity.map((row) => (
                <ActivityRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Home;
