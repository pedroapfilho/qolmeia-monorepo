"use client";

import { StatusPill, type StatusTone } from "@repo/ui/components/status-pill";
import { cn } from "@repo/ui/lib/utils";
import { Pencil } from "lucide-react";

import { STATUS_LABEL, type AgentDisplayStatus, type TeamMemberView } from "@/lib/team";

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
  if (m.role === "worker") {
    return m.workerKind;
  }
  return m.role;
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

const monogramOf = (name: string): string => (name.trim()[0] ?? "?").toLocaleUpperCase("pt-BR");

const STATUS_TONE: Record<AgentDisplayStatus, StatusTone> = {
  available: "success",
  awaiting_approval: "warning",
  paused: "neutral",
  working: "info",
};

const AgentCard = ({ member, variant }: AgentCardProps) => {
  const detailed = variant === "detailed";
  const tone = STATUS_TONE[member.status];
  return (
    <article className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[10px] font-display font-bold text-white",
          avatarClass(member),
          detailed ? "size-11 text-base" : "size-10 text-sm",
        )}
      >
        {monogramOf(member.displayName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{member.displayName}</h3>
          {member.hasPromptOverride && (
            <Pencil aria-label="Prompt personalizado" className="size-3 text-muted-foreground" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {detailed
            ? `${roleLabel(member)} · ${member.lifetimeDone} entregas`
            : `${member.lifetimeDone} entregas`}
        </p>
        {detailed && member.currentWork[0] && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            → {member.currentWork[0].summary}
          </p>
        )}
      </div>
      <StatusPill
        className="shrink-0"
        label={STATUS_LABEL[member.status]}
        pulse={member.status === "working"}
        tone={tone}
      />
    </article>
  );
};

export { AgentCard };
export type { AgentCardProps };
