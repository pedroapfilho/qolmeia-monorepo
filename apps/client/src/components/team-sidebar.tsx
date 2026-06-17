"use client";

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
      className="hidden w-[300px] flex-col gap-2.5 border-l border-border bg-card p-[18px] lg:flex"
    >
      <h2 className="mb-0.5 text-sm font-semibold">Seu Time</h2>
      {status === "loading" && members.length === 0 && (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      )}
      {error && (
        <p className="text-xs text-destructive">Falha ao carregar o time: {error.message}</p>
      )}
      <ul className="flex flex-col gap-2.5">
        {members.map((m) => (
          <li className="rounded-[10px] border border-border bg-card px-3.5 py-3" key={m.id}>
            <AgentCard member={m} variant="compact" />
          </li>
        ))}
      </ul>
      <Link
        className="mt-auto inline-flex items-center justify-center gap-1 rounded-[10px] border border-dashed border-input px-3 py-3 text-center text-sm font-semibold text-primary transition-colors hover:bg-highlight-surface"
        href="/empresa"
      >
        + Contratar mais agentes
      </Link>
    </aside>
  );
};

export { TeamSidebar };
