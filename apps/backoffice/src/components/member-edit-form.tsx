"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/lib/toast";
import { useState } from "react";

import { PromptEditor } from "@/components/prompt-editor";
import { apiSend } from "@/lib/api-client";
import type { TeamMemberDetailView } from "@/lib/team-fetch";

type MemberEditFormProps = {
  companyId: string;
  initialMember: TeamMemberDetailView;
  memberId: string;
};

const MemberEditForm = ({ companyId, initialMember, memberId }: MemberEditFormProps) => {
  const [member, setMember] = useState(initialMember);
  const [name, setName] = useState(initialMember.displayName);
  const [busy, setBusy] = useState(false);

  const patch = async (body: { displayName?: string; promptOverride?: string | null }) => {
    setBusy(true);
    try {
      const data = await apiSend<{ member: TeamMemberDetailView }>(
        "PATCH",
        `/teams/${companyId}/members/${memberId}`,
        body,
      );
      setMember(data.member);
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">{member.displayName}</h1>
        <p className="text-sm text-muted-foreground">
          {member.role === "worker" ? member.workerKind : member.role} · {member.status}
        </p>
      </header>
      <Field>
        <FieldLabel htmlFor="member-name">Nome</FieldLabel>
        <div className="flex gap-2">
          <Input
            disabled={busy}
            id="member-name"
            onChange={(e) => setName(e.target.value)}
            value={name}
          />
          <Button disabled={busy || name === member.displayName} onClick={handleSaveName}>
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
    </div>
  );
};

export { MemberEditForm };
