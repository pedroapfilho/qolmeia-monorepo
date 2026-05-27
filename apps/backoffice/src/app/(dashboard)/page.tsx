import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Activity, ArrowRight, Inbox, Ticket as TicketIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActivityRow } from "@/components/activity-row";
import { StatusPill } from "@/components/status-pill";
import { apiGetServer } from "@/lib/api-server";
import type { ActionsResponse, ActivityResponse, TicketsResponse } from "@/lib/api-types";
import { formatDurationSeconds, truncate } from "@/lib/format";

export const metadata: Metadata = { title: "Início" };

type StatCardProps = {
  cta: string;
  ctaHref: string;
  icon: React.ReactNode;
  label: string;
  subValue?: string;
  value: number;
};

const StatCard = ({ cta, ctaHref, icon, label, subValue, value }: StatCardProps) => (
  <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-2 [.border-b]:pb-6">
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4"
      >
        {icon}
      </span>
    </CardHeader>
    <CardContent className="flex items-end justify-between">
      <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {value}
        {subValue ? (
          <span className="ml-1.5 text-base font-normal text-muted-foreground">{subValue}</span>
        ) : null}
      </p>
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
        href={ctaHref}
      >
        {cta}
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </CardContent>
  </Card>
);

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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        description="Visão operacional: aprovações pendentes, tickets em curso e atividade recente."
        title="Início"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          cta="Decidir"
          ctaHref="/approvals"
          icon={<Inbox aria-hidden />}
          label="Aprovações pendentes"
          value={pending.length}
        />
        <StatCard
          cta="Ver tickets"
          ctaHref="/tickets"
          icon={<TicketIcon aria-hidden />}
          label="Tickets em curso"
          subValue={`/ ${tickets.length}`}
          value={openTickets}
        />
      </div>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Próximas aprovações</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="flex flex-col">
              {pending.slice(0, 5).map((action) => {
                const summary =
                  typeof action.proposed.summary === "string" ? action.proposed.summary : null;
                return (
                  <li
                    className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 last:border-b-0"
                    key={action.id}
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {action.actionType}
                        </span>
                        <StatusPill status={action.status} />
                        {action.ageSeconds !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            há {formatDurationSeconds(action.ageSeconds)}
                          </span>
                        )}
                      </div>
                      {summary ? (
                        <p className="text-sm text-muted-foreground">{truncate(summary, 180)}</p>
                      ) : null}
                    </div>
                    <Link
                      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                      href={`/approvals/${action.id}`}
                    >
                      Decidir
                      <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 [.border-b]:pb-6">
          <CardTitle>Eventos recentes</CardTitle>
          <Link
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            href="/activity"
          >
            Ver tudo
          </Link>
        </CardHeader>
        <CardContent className="px-0">
          {activity.length === 0 ? (
            <EmptyState
              description="Quando os agentes começarem a trabalhar, os eventos aparecem aqui."
              icon={<Activity aria-hidden />}
              title="Nada para mostrar ainda"
            />
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
