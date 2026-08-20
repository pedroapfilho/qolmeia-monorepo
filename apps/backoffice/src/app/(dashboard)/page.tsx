import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import type {
  ActionsResponse,
  ActivityResponse,
  TicketsResponse,
} from "@repo/worker-api/contracts";
import { Activity, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { agentAvatarClass, agentInitials } from "@/lib/agent-avatar";
import { apiGetServer } from "@/lib/api-server";
import { formatDurationSeconds, formatRelative } from "@/lib/format";
import { log } from "@/lib/observability";
import type { CompanyOverview } from "@/lib/team-fetch";

export const metadata: Metadata = { title: "Início" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const eventDotClass = (type: string): string => {
  if (type.startsWith("ACTION_")) {
    return "bg-primary";
  }
  if (type.startsWith("TICKET_")) {
    return "bg-info";
  }
  if (type.startsWith("WORKER_")) {
    return "bg-worker-surface-foreground";
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
  const hasHref = href !== undefined && href !== "";
  const body = (
    <Card
      className={cn(
        "gap-0 px-5 py-4",
        hasHref ? "transition-colors hover:border-input" : undefined,
      )}
    >
      <p className="text-[0.8125rem] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-display text-3xl font-bold tracking-tight tabular-nums",
          accent === true ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {sub !== undefined && sub !== "" ? (
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
    </Card>
  );

  return hasHref ? (
    <Link className="block" href={href}>
      {body}
    </Link>
  ) : (
    body
  );
};

const loadRecentEvents = async (): Promise<ActivityResponse | null> => {
  try {
    return await apiGetServer<ActivityResponse>("/activity?limit=8");
  } catch (error) {
    log.error({ error, message: "home: failed to load recent activity" });
    return null;
  }
};

const RecentEvents = async ({ activity }: { activity: Promise<ActivityResponse | null> }) => {
  const response = await activity;
  const items = response?.items ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        description="Quando os agentes começarem a trabalhar, os eventos aparecem aqui."
        icon={<Activity aria-hidden />}
        title="Nada para mostrar ainda"
      />
    );
  }

  return (
    <ul className="flex flex-col px-[18px] py-1.5">
      {items.slice(0, 6).map((row) => (
        <li className="flex gap-[11px] border-b border-border py-2.5 last:border-b-0" key={row.id}>
          <span
            aria-hidden
            className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", eventDotClass(row.type))}
          />
          <div className="min-w-0">
            <p className="text-[0.8125rem] leading-snug text-foreground">{row.summary}</p>
            <p className="mt-[3px] font-mono text-xs text-muted-foreground">
              {row.type} · {formatRelative(row.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
};

const RecentEventsSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-3 px-[18px] py-4">
    {Array.from({ length: 5 }, (_, index) => (
      <Skeleton className="h-9 w-full" key={index} />
    ))}
  </div>
);

const HomeContent = async () => {
  const activity = loadRecentEvents();

  const [pendingRes, ticketsRes, companiesRes] = await Promise.allSettled([
    apiGetServer<ActionsResponse>("/actions?status=pending&sort=age"),
    apiGetServer<TicketsResponse>("/tickets?limit=10"),
    apiGetServer<{ companies: Array<CompanyOverview> }>("/companies"),
  ]);

  const pending = pendingRes.status === "fulfilled" ? pendingRes.value.items : [];
  const tickets = ticketsRes.status === "fulfilled" ? ticketsRes.value.items : [];
  const companies = companiesRes.status === "fulfilled" ? companiesRes.value.companies : null;

  const openTickets = tickets.filter((t) =>
    ["in_progress", "open", "awaiting_approval"].includes(t.status),
  ).length;
  const doneTickets = tickets.filter((t) => t.status === "done").length;
  const oldestPendingAge = pending[0]?.ageSeconds;

  const activeCompanies =
    companies === null
      ? new Set(tickets.map((t) => t.companyId)).size
      : companies.filter((c) => c.status === "active").length;
  const onboardingCompanies =
    companies === null ? null : companies.filter((c) => c.status === "onboarding").length;

  const activeCompaniesLabel = activeCompanies === 1 ? "1 empresa" : `${activeCompanies} empresas`;
  const companiesSub =
    onboardingCompanies === null ? activeCompaniesLabel : `${onboardingCompanies} em onboarding`;

  return (
    <div className="flex flex-col gap-6">
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
        <StatCard label="Empresas ativas" sub={companiesSub} value={activeCompanies} />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1.25fr_1fr]">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex items-center border-b border-border px-[18px] py-[15px]">
            <h2 className="text-[0.90625rem] font-bold text-foreground">Próximas aprovações</h2>
            <Link
              className="ml-auto text-[0.78125rem] font-semibold text-primary transition-colors hover:text-primary/80"
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
                return (
                  <li className="border-b border-border last:border-b-0" key={action.id}>
                    <Link
                      className="flex items-center gap-3 px-[18px] py-[13px] transition-colors hover:bg-highlight-surface/40"
                      href={`/approvals/${action.id}`}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-[0.8125rem] font-bold text-white",
                          agentAvatarClass(action.agent.role, action.agent.workerKind),
                        )}
                      >
                        {agentInitials(action.agent.name)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[0.84375rem] font-semibold text-foreground">
                          {action.actionType}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {action.companyName} · {action.agent.name}
                        </span>
                      </div>
                      {action.ageSeconds === undefined ? null : (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
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
            <h2 className="text-[0.90625rem] font-bold text-foreground">Eventos recentes</h2>
          </div>
          <Suspense fallback={<RecentEventsSkeleton />}>
            <RecentEvents activity={activity} />
          </Suspense>
        </Card>
      </div>
    </div>
  );
};

const HomeSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="h-24" key={index} />
      ))}
    </div>
    <div className="grid gap-3.5 lg:grid-cols-[1.25fr_1fr]">
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  </div>
);

const Home = () => (
  <div className="flex flex-col gap-6">
    <PageHeader
      actions={
        <span className="rounded-lg border border-border bg-card px-3 py-2 text-[0.8125rem] font-semibold text-foreground">
          Últimos 7 dias
        </span>
      }
      description="Visão operacional · todas as empresas"
      title="Início"
    />
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  </div>
);

export default Home;
