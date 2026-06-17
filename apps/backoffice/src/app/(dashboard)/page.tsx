import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { cn } from "@repo/ui/lib/utils";
import { Activity, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { apiGetServer } from "@/lib/api-server";
import type { ActionsResponse, ActivityResponse, TicketsResponse } from "@/lib/api-types";
import { formatDurationSeconds, formatRelative, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Início" };

// Color-key each event dot by its type prefix — same prefix→category
// mapping the activity row uses, so the two surfaces stay consistent.
const eventDotClass = (type: string): string => {
  if (type.startsWith("ACTION_")) {
    return "bg-primary";
  }
  if (type.startsWith("TICKET_")) {
    return "bg-info";
  }
  if (type.startsWith("WORKER_")) {
    return "bg-cyan-surface-foreground";
  }
  if (type.startsWith("TEAM_")) {
    return "bg-success";
  }
  if (type.startsWith("MEMBER_")) {
    return "bg-destructive";
  }
  return "bg-muted-foreground";
};

type StatCardProps = {
  accent?: boolean;
  href?: string;
  label: string;
  sub?: string;
  value: number | string;
};

const StatCard = ({ accent, href, label, sub, value }: StatCardProps) => {
  const body = (
    <Card
      className={cn("gap-0 px-5 py-4", href ? "transition-colors hover:border-input" : undefined)}
    >
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-display text-3xl font-bold tracking-tight tabular-nums",
          accent ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );

  return href ? (
    <Link className="block" href={href}>
      {body}
    </Link>
  ) : (
    body
  );
};

const Home = async () => {
  // Parallel fetch — Promise.allSettled so a transient failure on one
  // endpoint doesn't blank the entire dashboard.
  const [pendingRes, ticketsRes, activityRes] = await Promise.allSettled([
    apiGetServer<ActionsResponse>("/actions?status=pending&sort=age"),
    apiGetServer<TicketsResponse>("/tickets?limit=10"),
    apiGetServer<ActivityResponse>("/activity?limit=8"),
  ]);

  const pending = pendingRes.status === "fulfilled" ? pendingRes.value.items : [];
  const tickets = ticketsRes.status === "fulfilled" ? ticketsRes.value.items : [];
  const activity = activityRes.status === "fulfilled" ? activityRes.value.items : [];

  const openTickets = tickets.filter((t) =>
    ["in_progress", "open", "awaiting_approval"].includes(t.status),
  ).length;
  const doneTickets = tickets.filter((t) => t.status === "done").length;
  const activeCompanies = new Set(tickets.map((t) => t.companyId)).size;
  const oldestPendingAge = pending[0]?.ageSeconds;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          <span className="rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-semibold text-foreground">
            Últimos 7 dias
          </span>
        }
        description="Visão operacional · todas as empresas"
        title="Início"
      />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          accent
          href="/approvals"
          label="Aprovações pendentes"
          sub={
            oldestPendingAge === undefined
              ? undefined
              : `a mais antiga há ${formatDurationSeconds(oldestPendingAge)}`
          }
          value={pending.length}
        />
        <StatCard
          href="/tickets"
          label="Tickets abertos"
          sub={`de ${tickets.length} no total`}
          value={openTickets}
        />
        <StatCard label="Concluídos no mês" value={doneTickets} />
        <StatCard
          label="Empresas ativas"
          sub={activeCompanies === 1 ? "1 empresa" : `${activeCompanies} empresas`}
          value={activeCompanies}
        />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1.25fr_1fr]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex items-center border-b border-border px-[18px] py-[15px]">
            <h2 className="text-[14.5px] font-bold text-foreground">Próximas aprovações</h2>
            <Link
              className="ml-auto text-[12.5px] font-semibold text-primary transition-colors hover:text-primary/80"
              href="/approvals"
            >
              Ver todas
            </Link>
          </div>
          {pending.length === 0 ? (
            <EmptyState
              description="Quando um agente propuser uma ação, ela aparece aqui para decisão."
              icon={<ArrowRight aria-hidden />}
              title="Nenhuma aprovação pendente"
            />
          ) : (
            <ul className="flex flex-col">
              {pending.slice(0, 4).map((action) => {
                const summary =
                  typeof action.proposed.summary === "string" ? action.proposed.summary : null;
                return (
                  <li className="border-b border-border last:border-b-0" key={action.id}>
                    <Link
                      className="flex items-center gap-3 px-[18px] py-[13px] transition-colors hover:bg-highlight-surface/40"
                      href={`/approvals/${action.id}`}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[13.5px] font-semibold text-foreground">
                          {action.actionType}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {summary ? truncate(summary, 80) : action.ticketId}
                        </span>
                      </div>
                      {action.ageSeconds === undefined ? null : (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {formatDurationSeconds(action.ageSeconds)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="gap-0 overflow-hidden p-0">
          <div className="border-b border-border px-[18px] py-[15px]">
            <h2 className="text-[14.5px] font-bold text-foreground">Eventos recentes</h2>
          </div>
          {activity.length === 0 ? (
            <EmptyState
              description="Quando os agentes começarem a trabalhar, os eventos aparecem aqui."
              icon={<Activity aria-hidden />}
              title="Nada para mostrar ainda"
            />
          ) : (
            <ul className="flex flex-col px-[18px] py-1.5">
              {activity.slice(0, 6).map((row) => (
                <li
                  className="flex gap-[11px] border-b border-border py-2.5 last:border-b-0"
                  key={row.id}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-[7px] shrink-0 rounded-full",
                      eventDotClass(row.type),
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug text-foreground">{row.summary}</p>
                    <p className="mt-[3px] font-mono text-[10px] text-muted-foreground">
                      {row.type} · {formatRelative(row.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Home;
