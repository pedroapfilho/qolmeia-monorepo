"use client";

import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import { cn } from "@repo/ui/lib/utils";
import { UserPlus } from "lucide-react";
import { useState } from "react";

import { InviteForm } from "@/components/invite-form";
import type { TeamMemberRow } from "@/lib/api-types";

type TeamPageClientProps = {
  members: ReadonlyArray<TeamMemberRow>;
};

const roleBadge = (role: TeamMemberRow["role"]): string => {
  if (role === "OWNER") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  if (role === "STAFF") {
    return "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200";
  }
  return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
};

const roleLabel = (role: TeamMemberRow["role"]): string => {
  if (role === "OWNER") {
    return "Dono";
  }
  if (role === "STAFF") {
    return "Equipe";
  }
  return "Cliente";
};

// Team list + slide-out invite form. Stays a client component so the
// invite form's open/close state survives toast-driven router refreshes.
const TeamPageClient = ({ members }: TeamPageClientProps) => {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Equipe</h1>
          <p className="text-sm text-muted-foreground">
            Donos, equipe operacional e clientes com acesso ao chat.
          </p>
        </div>
        <Button onClick={() => setInviteOpen((open) => !open)} type="button">
          <UserPlus aria-hidden />
          {inviteOpen ? "Fechar" : "Convidar"}
        </Button>
      </header>

      {inviteOpen ? (
        <Card>
          <CardContent className="py-5">
            <InviteForm onClose={() => setInviteOpen(false)} />
          </CardContent>
        </Card>
      ) : null}

      {members.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum membro ainda. Convide alguém para começar.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0">
            <ul className="divide-y divide-border">
              {members.map((member) => (
                <li className="flex items-center justify-between gap-3 px-6 py-4" key={member.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {member.user.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      roleBadge(member.role),
                    )}
                  >
                    {roleLabel(member.role)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export { TeamPageClient };
