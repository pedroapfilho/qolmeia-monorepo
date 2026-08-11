import { Card } from "@repo/ui/components/card";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import { StatusPill, type StatusTone } from "@repo/ui/components/status-pill";
import { cn } from "@repo/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { agentAvatarClass, agentInitials } from "@/lib/agent-avatar";
import { apiGetServer } from "@/lib/api-server";
import { requireStaff } from "@/lib/auth-helpers";
import type { CompanyOverview, TeamMemberView } from "@/lib/team-fetch";

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const COMPANY_STATUS: Record<CompanyOverview["status"], { label: string; tone: StatusTone }> = {
  active: { label: "Ativo", tone: "success" },
  onboarding: { label: "Onboarding", tone: "warning" },
  paused: { label: "Pausado", tone: "neutral" },
};

const MEMBER_STATUS: Record<
  TeamMemberView["status"],
  { label: string; pulse: boolean; tone: StatusTone }
> = {
  available: { label: "Disponível", pulse: false, tone: "success" },
  awaiting_approval: { label: "Aguardando", pulse: false, tone: "warning" },
  paused: { label: "Pausado", pulse: false, tone: "neutral" },
  working: { label: "Trabalhando", pulse: true, tone: "info" },
};

const ROLE_LABEL: Record<TeamMemberView["role"], string> = {
  correspondent: "Correspondente",
  planner: "Planejador",
  worker: "",
};

const memberRoleLabel = (m: TeamMemberView): string =>
  m.role === "worker" ? (m.workerKind ?? "Especialista") : ROLE_LABEL[m.role];

const TeamsContent = async () => {
  await requireStaff();
  const { companies } = await apiGetServer<{ companies: Array<CompanyOverview> }>("/companies");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Empresas e seus agentes." title="Times" />

      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((company) => {
          const companyStatus = COMPANY_STATUS[company.status];
          return (
            <Card className="gap-0 overflow-hidden p-0" key={company.id}>
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-avatar-7 font-display text-sm font-bold text-white"
                >
                  {agentInitials(company.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-foreground">{company.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {company.members.length} agentes · brief {company.briefPercent}%
                  </div>
                </div>
                <StatusPill
                  className="shrink-0"
                  label={companyStatus.label}
                  tone={companyStatus.tone}
                />
              </div>
              <div className="flex flex-col px-3 py-3">
                {company.members.map((m) => {
                  const memberStatus = MEMBER_STATUS[m.status];
                  return (
                    <Link
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                      href={`/teams/${company.id}/members/${m.id}`}
                      key={m.id}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-[30px] shrink-0 items-center justify-center rounded-lg font-display text-[11px] font-bold text-white",
                          agentAvatarClass(m.role, m.workerKind),
                        )}
                      >
                        {agentInitials(m.displayName)}
                      </span>
                      <span className="flex-1 truncate text-[13.5px] font-semibold text-foreground">
                        {memberRoleLabel(m)}
                      </span>
                      <StatusPill
                        className="shrink-0"
                        label={memberStatus.label}
                        pulse={memberStatus.pulse}
                        tone={memberStatus.tone}
                      />
                      <ChevronRight
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground/60"
                      />
                    </Link>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const TeamsSkeleton = () => (
  <div aria-hidden className="flex flex-col gap-6">
    <PageHeader description="Empresas e seus agentes." title="Times" />
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  </div>
);

const TeamsPage = () => (
  <Suspense fallback={<TeamsSkeleton />}>
    <TeamsContent />
  </Suspense>
);

export default TeamsPage;
