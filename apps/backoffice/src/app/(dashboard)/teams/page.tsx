import { Card } from "@repo/ui/components/card";
import { PageHeader } from "@repo/ui/components/page-header";
import { cn } from "@repo/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

import { requireStaff } from "@/lib/auth-helpers";
import { fetchTeam, type TeamMemberView } from "@/lib/team-fetch";

const STATUS_LABEL: Record<TeamMemberView["status"], string> = {
  available: "Disponível",
  awaiting_approval: "Aguardando",
  paused: "Pausado",
  working: "Trabalhando",
};

const STATUS_DOT: Record<TeamMemberView["status"], string> = {
  available: "bg-success",
  awaiting_approval: "bg-warning",
  paused: "bg-muted-foreground/60",
  working: "bg-info",
};

const STATUS_TEXT: Record<TeamMemberView["status"], string> = {
  available: "text-success",
  awaiting_approval: "text-warning",
  paused: "text-muted-foreground",
  working: "text-info",
};

const WORKER_KIND_AVATAR: ReadonlyArray<{ cls: string; match: RegExp }> = [
  { cls: "bg-avatar-2", match: /design|art|imagem/iv },
  { cls: "bg-avatar-3", match: /estrateg|strateg|plano/iv },
  { cls: "bg-avatar-4", match: /redat|copy|escrit|texto/iv },
  { cls: "bg-avatar-5", match: /social|m[ií]dia|community/iv },
];

const avatarClass = (m: TeamMemberView): string => {
  if (m.role === "correspondent") {
    return "bg-avatar-1";
  }
  if (m.role === "planner") {
    return "bg-avatar-6";
  }
  const kind = m.workerKind ?? "";
  const hit = WORKER_KIND_AVATAR.find((w) => w.match.test(kind));
  return hit?.cls ?? "bg-avatar-8";
};

const roleLabel = (m: TeamMemberView): string => {
  if (m.role === "correspondent") {
    return "Correspondente";
  }
  if (m.role === "planner") {
    return "Planejador";
  }
  return m.workerKind ?? "Especialista";
};

const monogramOf = (value: string): string => (value.trim()[0] ?? "?").toLocaleUpperCase("pt-BR");

const TeamsPage = async () => {
  const session = await requireStaff();
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";
  const companyId = session.currentOrg?.id ?? "";
  const companyName = session.currentOrg?.name ?? companyId;
  const members = await fetchTeam(companyId, cookie);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Empresas e seus agentes." title="Times" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-avatar-7 font-display text-sm font-bold text-white"
            >
              {monogramOf(companyName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-foreground">{companyName}</div>
              <div className="text-xs text-muted-foreground">{members.length} agentes</div>
            </div>
          </div>
          <div className="flex flex-col px-3 py-3">
            {members.map((m) => (
              <Link
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                href={`/teams/${companyId}/members/${m.id}`}
                key={m.id}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-[30px] shrink-0 items-center justify-center rounded-lg font-display text-[11px] font-bold text-white",
                    avatarClass(m),
                  )}
                >
                  {monogramOf(m.displayName)}
                </span>
                <span className="flex-1 truncate text-[13.5px] font-semibold text-foreground">
                  {roleLabel(m)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[11.5px] font-semibold",
                    STATUS_TEXT[m.status],
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      STATUS_DOT[m.status],
                      m.status === "working" && "animate-pulse",
                    )}
                  />
                  {STATUS_LABEL[m.status]}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default TeamsPage;
