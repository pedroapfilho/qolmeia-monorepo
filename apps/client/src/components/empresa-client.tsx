"use client";

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { PageContainer } from "@repo/ui/components/page-container";
import { PageHeader } from "@repo/ui/components/page-header";
import { toast } from "@repo/ui/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { BrandAssets } from "@/components/brand-assets";
import { CompanyBriefForm } from "@/components/company-brief-form";
import { HireDialog } from "@/components/hire-dialog";
import { PromptEditor } from "@/components/prompt-editor";
import {
  fetchCatalogue,
  fetchMemberDetail,
  patchMember,
  setPaused,
  type HireableTemplate,
  type TeamMemberDetailView,
} from "@/lib/team";
import { useTeamRoster } from "@/lib/use-team-roster";

const CATALOGUE_QUERY_KEY = ["catalogue"] as const;

type EmpresaClientProps = {
  companyId: string;
  sessionToken: string;
};

const EmpresaClient = ({ companyId, sessionToken }: EmpresaClientProps) => {
  const [hireTemplate, setHireTemplate] = useState<HireableTemplate | null>(null);
  const [detail, setDetail] = useState<TeamMemberDetailView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { members, refetch } = useTeamRoster(companyId, sessionToken);
  const { data: catalogue = [] } = useQuery({
    meta: { errorToast: "Falha ao carregar catálogo" },
    queryFn: fetchCatalogue,
    queryKey: CATALOGUE_QUERY_KEY,
  });

  const handleOpenDetail = async (id: string) => {
    try {
      setDetail(await fetchMemberDetail(id));
    } catch {
      toast.error("Falha ao carregar agente. Tente novamente.");
    }
  };

  const handleCloseDetail = (id: string) => {
    if (detail?.id === id) {
      setDetail(null);
    }
  };

  const handleSavePrompt = async (id: string, value: string) => {
    setBusyId(id);
    try {
      await patchMember(id, { promptOverride: value });
      toast.success("Prompt atualizado.");
      await handleOpenDetail(id);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    setBusyId(null);
  };

  const handleResetPrompt = async (id: string) => {
    setBusyId(id);
    try {
      await patchMember(id, { promptOverride: null });
      toast.success("Prompt restaurado.");
      await handleOpenDetail(id);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    setBusyId(null);
  };

  const handleTogglePause = async (id: string, paused: boolean) => {
    setBusyId(id);
    try {
      await setPaused(id, paused);
      await refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    setBusyId(null);
  };

  const handleHired = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: CATALOGUE_QUERY_KEY });
  };

  return (
    <PageContainer>
      <PageHeader
        description="Veja seu time e contrate mais agentes. Personalize o comportamento de cada um."
        title="Minha empresa"
      />

      <CompanyBriefForm />

      <BrandAssets />

      <section aria-label="Meu time" className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">Meu time</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex flex-col gap-4">
                <AgentCard member={m} variant="detailed" />
                <div className="flex flex-wrap gap-2">
                  {m.role === "worker" && (
                    <>
                      {detail?.id === m.id ? (
                        <Button onClick={() => handleCloseDetail(m.id)} size="sm" variant="outline">
                          Fechar editor
                        </Button>
                      ) : (
                        <Button onClick={() => handleOpenDetail(m.id)} size="sm" variant="outline">
                          Editar prompt
                        </Button>
                      )}
                      <Button
                        disabled={busyId === m.id}
                        onClick={() => handleTogglePause(m.id, m.status !== "paused")}
                        size="sm"
                        variant="ghost"
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
                    onReset={() => handleResetPrompt(m.id)}
                    onSave={(v) => handleSavePrompt(m.id, v)}
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
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Contratar mais agentes
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {catalogue.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <CardTitle className="text-base">{t.displayName}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs tracking-wide text-muted-foreground">
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
        onHired={handleHired}
        open={hireTemplate !== null}
        template={hireTemplate}
      />
    </PageContainer>
  );
};

export { EmpresaClient };
