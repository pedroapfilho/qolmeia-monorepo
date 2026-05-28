"use client";

import { Avatar } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Pencil } from "lucide-react";

import { STATUS_LABEL, STATUS_VARIANT, type TeamMemberView } from "@/lib/team";

type Variant = "compact" | "detailed";

type AgentCardProps = {
  member: TeamMemberView;
  variant: Variant;
};

const roleLabel = (m: TeamMemberView): string => {
  if (m.role === "correspondent") {
    return "Correspondente";
  }
  if (m.role === "planner") {
    return "Planejador";
  }
  return m.workerKind ?? "Worker";
};

const AgentCard = ({ member, variant }: AgentCardProps) => (
  <article className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
    <Avatar
      name={member.displayName}
      seed={member.id}
      size={variant === "detailed" ? "lg" : "md"}
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <h3 className="truncate text-sm font-medium">{member.displayName}</h3>
        {member.hasPromptOverride && (
          <Pencil aria-label="Prompt personalizado" className="size-3 text-muted-foreground" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{roleLabel(member)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_VARIANT[member.status]}>{STATUS_LABEL[member.status]}</Badge>
        {member.currentWork[0] && (
          <span className="truncate text-xs text-muted-foreground">
            → {member.currentWork[0].summary}
          </span>
        )}
      </div>
      {variant === "detailed" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Tickets concluídos: {member.lifetimeDone}
        </p>
      )}
    </div>
  </article>
);

export { AgentCard };
export type { AgentCardProps };
