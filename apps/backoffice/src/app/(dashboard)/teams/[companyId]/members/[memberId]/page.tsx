"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/lib/toast";
import { use, useEffect, useState } from "react";

import { PromptEditor } from "@/components/prompt-editor";

// Inline minimal copy of TeamMemberDetailView so the page doesn't depend on
// a server lib import (the page is a client component and the existing
// team-fetch.ts is server-only).
type TeamMemberDetailView = {
  capabilities: string;
  currentWork: ReadonlyArray<{
    status: "in_progress" | "awaiting_approval";
    summary: string;
    ticketId: string;
  }>;
  displayName: string;
  hasPromptOverride: boolean;
  id: string;
  lifetimeDone: number;
  promptOverride: string | null;
  promptOverrideUpdatedAt: number | null;
  role: "correspondent" | "planner" | "worker";
  status: "available" | "working" | "awaiting_approval" | "paused";
  templateId: string | null;
  templateSystemPrompt: string;
  workerKind: string | null;
};

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

type Props = { params: Promise<{ companyId: string; memberId: string }> };

const MemberEditPage = ({ params }: Props) => {
  const { companyId, memberId } = use(params);
  const [member, setMember] = useState<TeamMemberDetailView | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(
          `${AGENTS_URL}/api/backoffice/teams/${companyId}/members/${memberId}`,
          { credentials: "include" },
        );
        const b = (await res.json()) as { member: TeamMemberDetailView };
        setMember(b.member);
        setName(b.member.displayName);
      } catch (error) {
        toast.error(String(error));
      }
    };
    void load();
  }, [companyId, memberId]);

  if (!member) {
    return <p>Carregando…</p>;
  }

  const patch = async (body: { displayName?: string; promptOverride?: string | null }) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${AGENTS_URL}/api/backoffice/teams/${companyId}/members/${memberId}`,
        {
          body: JSON.stringify(body),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      if (!res.ok) {
        throw new Error(`patch failed ${res.status}`);
      }
      const data = (await res.json()) as { member: TeamMemberDetailView };
      setMember(data.member);
      return data.member;
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    try {
      await patch({ displayName: name });
      toast.success("Nome atualizado.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const savePrompt = async (value: string) => {
    try {
      await patch({ promptOverride: value });
      toast.success("Prompt atualizado.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const resetPrompt = async () => {
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
          <Button disabled={busy || name === member.displayName} onClick={saveName}>
            Renomear
          </Button>
        </div>
      </Field>
      <PromptEditor
        busy={busy}
        initialValue={member.promptOverride}
        onReset={resetPrompt}
        onSave={savePrompt}
        templatePrompt={member.templateSystemPrompt}
        updatedAt={member.promptOverrideUpdatedAt}
      />
    </div>
  );
};

export default MemberEditPage;
