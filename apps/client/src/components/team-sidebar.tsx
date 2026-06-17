"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AgentCard } from "@/components/agent-card";
import { useTeamRoster } from "@/lib/use-team-roster";

type TeamSidebarProps = {
  companyId: string;
  sessionToken: string;
};

const TeamSidebar = ({ companyId, sessionToken }: TeamSidebarProps) => {
  const { error, members, status } = useTeamRoster(companyId, sessionToken);
  return (
    <aside
      aria-label="Seu time"
      className="hidden w-72 flex-col gap-3 border-l border-border bg-background/60 p-4 lg:flex"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Seu time</h2>
        <span className="text-xs text-muted-foreground">{members.length}</span>
      </div>
      {status === "loading" && members.length === 0 && (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      )}
      {error && (
        <p className="text-xs text-destructive">Falha ao carregar o time: {error.message}</p>
      )}
      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <li
            className="rounded-lg border border-border bg-card p-3"
            key={m.id}
          >
            <AgentCard member={m} variant="compact" />
          </li>
        ))}
      </ul>
      <Link
        className="mt-auto inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 py-2 text-sm font-medium hover:bg-muted hover:text-foreground"
        href="/empresa"
      >
        Ver minha empresa
        <ArrowRight aria-hidden className="size-3" />
      </Link>
    </aside>
  );
};

export { TeamSidebar };
