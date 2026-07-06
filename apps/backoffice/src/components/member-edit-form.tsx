"use client";

import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import { Field, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { StatusPill, type StatusTone } from "@repo/ui/components/status-pill";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import { useState } from "react";

import { BackLink } from "@/components/back-link";
import { PromptEditor } from "@/components/prompt-editor";
import { apiSend } from "@/lib/api-client";
import type { TeamMemberDetailView } from "@/lib/team-fetch";

type MemberEditFormProps = {
  companyId: string;
  initialMember: TeamMemberDetailView;
  memberId: string;
};

const STATUS_LABEL: Record<TeamMemberDetailView["status"], string> = {
  available: "Disponível",
  awaiting_approval: "Aguardando aprovação",
  paused: "Pausado",
  working: "Trabalhando",
};

const STATUS_TONE: Record<TeamMemberDetailView["status"], StatusTone> = {
  available: "success",
  awaiting_approval: "warning",
  paused: "neutral",
  working: "info",
};

const WORKER_KIND_AVATAR: ReadonlyArray<{ cls: string; match: RegExp }> = [
  { cls: "bg-avatar-2", match: /design|art|imagem/iv },
  { cls: "bg-avatar-3", match: /estrateg|strateg|plano/iv },
  { cls: "bg-avatar-4", match: /redat|copy|escrit|texto/iv },
  { cls: "bg-avatar-5", match: /social|m[ií]dia|community/iv },
];

const avatarClass = (m: TeamMemberDetailView): string => {
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

const roleLabel = (m: TeamMemberDetailView): string => {
  if (m.role === "correspondent") {
    return "Correspondente";
  }
  if (m.role === "planner") {
    return "Planejador";
  }
  return m.workerKind ?? "Especialista";
};

const MemberEditForm = ({ companyId, initialMember, memberId }: MemberEditFormProps) => {
  const [member, setMember] = useState(initialMember);
  const [name, setName] = useState(initialMember.displayName);
  const [busy, setBusy] = useState(false);

  const patch = async (body: {
    displayName?: string;
    promptOverride?: string | null;
    status?: "active" | "paused";
  }) => {
    setBusy(true);
    const result = await apiSend<{ member: TeamMemberDetailView }>(
      "PATCH",
      `/teams/${companyId}/members/${memberId}`,
      body,
    ).then(
      (data) => ({ data, ok: true as const }),
      (error: unknown) => ({ error, ok: false as const }),
    );
    setBusy(false);
    if (!result.ok) {
      throw result.error;
    }
    setMember(result.data.member);
  };

  const handleSaveName = async () => {
    try {
      await patch({ displayName: name });
      toast.success("Nome atualizado.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleSavePrompt = async (value: string) => {
    try {
      await patch({ promptOverride: value });
      toast.success("Prompt atualizado.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleResetPrompt = async () => {
    try {
      await patch({ promptOverride: null });
      toast.success("Prompt restaurado.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleTogglePause = async () => {
    const next = member.status === "paused" ? "active" : "paused";
    try {
      await patch({ status: next });
      toast.success(next === "paused" ? "Agente pausado." : "Agente retomado.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const monogram = (member.displayName.trim()[0] ?? "?").toLocaleUpperCase("pt-BR");
  const memberSince = new Date(member.createdAt).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/teams">Times</BackLink>

      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-[13px] font-display text-xl font-bold text-white",
            avatarClass(member),
          )}
        >
          {monogram}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              {roleLabel(member)}
            </h1>
            <StatusPill
              label={STATUS_LABEL[member.status]}
              pulse={member.status === "working"}
              tone={STATUS_TONE[member.status]}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {member.companyName}
            {member.templateId ? ` · ${member.templateId}` : ""}
          </p>
        </div>
        {member.role === "worker" ? (
          <Button disabled={busy} onClick={handleTogglePause} variant="outline">
            {member.status === "paused" ? "Retomar" : "Pausar"}
          </Button>
        ) : null}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <div className="text-[12.5px] text-muted-foreground">Entregas</div>
            <div className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
              {member.lifetimeDone}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-[12.5px] text-muted-foreground">Em andamento</div>
            <div className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
              {member.currentWork.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-[12.5px] text-muted-foreground">No time desde</div>
            <div className="mt-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
              {memberSince}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="member-name">Nome de exibição</FieldLabel>
            <div className="flex gap-2">
              <Input
                disabled={busy}
                id="member-name"
                onChange={(e) => setName(e.target.value)}
                value={name}
              />
              <Button
                disabled={busy || name === member.displayName}
                onClick={handleSaveName}
                variant="outline"
              >
                Renomear
              </Button>
            </div>
          </Field>

          <PromptEditor
            busy={busy}
            initialValue={member.promptOverride}
            onReset={handleResetPrompt}
            onSave={handleSavePrompt}
            templatePrompt={member.templateSystemPrompt}
            updatedAt={member.promptOverrideUpdatedAt}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export { MemberEditForm };
