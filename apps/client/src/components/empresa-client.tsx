"use client";

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { toast } from "@repo/ui/lib/toast";
import { useEffect, useRef, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { HireDialog } from "@/components/hire-dialog";
import { PromptEditor } from "@/components/prompt-editor";
import {
  fetchCatalogue,
  patchMember,
  setPaused,
  type HireableTemplate,
  type TeamMemberDetailView,
} from "@/lib/team";
import { useTeamRoster } from "@/lib/use-team-roster";

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

type EmpresaClientProps = {
  companyId: string;
  sessionToken: string;
};

const EmpresaClient = ({ companyId, sessionToken }: EmpresaClientProps) => {
  const [catalogue, setCatalogue] = useState<Array<HireableTemplate>>([]);
  const [hireTemplate, setHireTemplate] = useState<HireableTemplate | null>(null);
  const [detail, setDetail] = useState<TeamMemberDetailView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { error: rosterError, members, refetch } = useTeamRoster(companyId, sessionToken);

  const loadCatalogue = async () => {
    try {
      const templates = await fetchCatalogue();
      setCatalogue(templates);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    // oxlint-disable-next-line react-hooks-js/set-state-in-effect
    loadCatalogue();
  }, []);

  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (rosterError && rosterError.message !== lastErrorRef.current) {
      toast.error(`Falha ao sincronizar time: ${rosterError.message}`);
      lastErrorRef.current = rosterError.message;
    } else if (!rosterError) {
      lastErrorRef.current = null;
    }
  }, [rosterError]);

  const openDetail = async (id: string) => {
    try {
      const res = await fetch(`${AGENTS_URL}/api/me/team/members/${id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Falha ao carregar agente (${res.status})`);
      }
      const body = (await res.json()) as { member: TeamMemberDetailView };
      setDetail(body.member);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const closeDetail = (id: string) => {
    if (detail?.id === id) {
      setDetail(null);
    }
  };

  const savePrompt = async (id: string, value: string) => {
    setBusyId(id);
    try {
      await patchMember(id, { promptOverride: value });
      toast.success("Prompt atualizado.");
      await openDetail(id);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const resetPrompt = async (id: string) => {
    setBusyId(id);
    try {
      await patchMember(id, { promptOverride: null });
      toast.success("Prompt restaurado.");
      await openDetail(id);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const togglePause = async (id: string, paused: boolean) => {
    setBusyId(id);
    try {
      await setPaused(id, paused);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Minha empresa</h1>
        <p className="text-sm text-muted-foreground">
          Veja seu time e contrate mais agentes. Personalize o comportamento de cada um.
        </p>
      </header>

      <section aria-label="Meu time" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Meu time</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex flex-col gap-3 pt-6">
                <AgentCard member={m} variant="detailed" />
                <div className="flex flex-wrap gap-2">
                  {m.role === "worker" && (
                    <>
                      {detail?.id === m.id ? (
                        <Button onClick={() => closeDetail(m.id)} size="sm" variant="outline">
                          Fechar editor
                        </Button>
                      ) : (
                        <Button onClick={() => openDetail(m.id)} size="sm" variant="outline">
                          Editar prompt
                        </Button>
                      )}
                      <Button
                        disabled={busyId === m.id}
                        onClick={() => togglePause(m.id, m.status !== "paused")}
                        size="sm"
                        variant="outline"
                      >
                        {m.status === "paused" ? "Retomar" : "Pausar"}
                      </Button>
                    </>
                  )}
                </div>
                {detail?.id === m.id && m.role === "worker" && (
                  <PromptEditor
                    busy={busyId === m.id}
                    initialValue={detail.promptOverride}
                    onReset={() => resetPrompt(m.id)}
                    onSave={(v) => savePrompt(m.id, v)}
                    templatePrompt={detail.templateSystemPrompt}
                    updatedAt={detail.promptOverrideUpdatedAt}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Contratar mais agentes" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Contratar mais agentes</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {catalogue.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle className="text-base">{t.displayName}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t.hiredCount > 0 ? `Você já tem ${t.hiredCount}` : "Nenhum ainda"}
                </span>
                <Button onClick={() => setHireTemplate(t)} size="sm">
                  Contratar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <HireDialog
        onClose={() => setHireTemplate(null)}
        onHired={async () => {
          try {
            await refetch();
            await loadCatalogue();
          } catch (error) {
            toast.error(
              `Hire ok, mas falha ao atualizar: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }}
        open={hireTemplate !== null}
        template={hireTemplate}
      />
    </div>
  );
};

export { EmpresaClient };
