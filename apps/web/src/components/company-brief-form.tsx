"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Field, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Skeleton } from "@repo/ui/components/skeleton";
import { StatusPill } from "@repo/ui/components/status-pill";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  type BriefPatch,
  type CompanyBrief,
  type CompanyResponse,
  fetchCompany,
  patchCompanyBrief,
} from "@/lib/company";

const companyQueryKey = (companyId: string) => ["company", companyId] as const;
const REQUIRED_COUNT = 6;

type FormState = {
  audience: string;
  industry: string;
  palette: string;
  primaryGoal: string;
  references: string;
  voice: string;
};

const briefToForm = (brief: CompanyBrief): FormState => ({
  audience: brief.audience ?? "",
  industry: brief.industry ?? "",
  palette: brief.brand?.palette ?? "",
  primaryGoal: brief.primaryGoal ?? "",
  references: brief.brand?.references ?? "",
  voice: brief.brand?.voice ?? "",
});

const buildPatch = (f: FormState): BriefPatch => {
  const patch: BriefPatch = {};
  if (f.industry.trim()) {
    patch.industry = f.industry.trim();
  }
  if (f.primaryGoal.trim()) {
    patch.primaryGoal = f.primaryGoal.trim();
  }
  if (f.audience.trim()) {
    patch.audience = f.audience.trim();
  }
  patch.brand = {
    palette: f.palette.trim() || undefined,
    references: f.references.trim() || undefined,
    voice: f.voice.trim() || undefined,
  };
  return patch;
};

const liveFilledCount = (f: FormState): number =>
  [
    f.industry.trim(),
    f.primaryGoal.trim(),
    f.audience.trim(),
    f.voice.trim(),
    f.palette.trim(),
    f.references.trim(),
  ].filter(Boolean).length;

const MissingMark = ({ show }: { show: boolean }) =>
  show ? (
    <Badge className="ml-2 align-middle" variant="warning">
      A preencher
    </Badge>
  ) : null;

type BriefCardProps = { companyId: string; initial: CompanyBrief };

const BriefCard = ({ companyId, initial }: BriefCardProps) => {
  const queryClient = useQueryClient();
  const queryKey = companyQueryKey(companyId);
  const [form, setForm] = useState<FormState>(() => briefToForm(initial));

  const mutation = useMutation({
    mutationFn: (patch: BriefPatch) => patchCompanyBrief(patch),
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
    onSuccess: (res) => {
      queryClient.setQueryData(queryKey, res);
      toast.success("Informações da empresa salvas.");
    },
  });

  const filled = liveFilledCount(form);
  const percent = Math.round((filled / REQUIRED_COUNT) * 100);
  const isComplete = filled === REQUIRED_COUNT;

  const setField = (key: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate(buildPatch(form));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 [.border-b]:pb-6">
        <CardTitle>Sobre a empresa</CardTitle>
        {isComplete ? (
          <StatusPill dotless label="Completo" tone="success" />
        ) : (
          <StatusPill dotless label={`${percent}% completo`} tone="neutral" />
        )}
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="brief-industry">
                Setor
                <MissingMark show={!form.industry.trim()} />
              </FieldLabel>
              <Input
                autoComplete="off"
                id="brief-industry"
                onChange={(e) => {
                  setField("industry")(e.currentTarget.value);
                }}
                placeholder="Ex: alimentação saudável"
                value={form.industry}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brief-goal">
                Objetivo principal (3 meses)
                <MissingMark show={!form.primaryGoal.trim()} />
              </FieldLabel>
              <Input
                autoComplete="off"
                id="brief-goal"
                onChange={(e) => {
                  setField("primaryGoal")(e.currentTarget.value);
                }}
                placeholder="Ex: aumentar vendas no Instagram"
                value={form.primaryGoal}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="brief-audience">
              Público-alvo
              <MissingMark show={!form.audience.trim()} />
            </FieldLabel>
            <Textarea
              autoComplete="off"
              className="min-h-20"
              id="brief-audience"
              onChange={(e) => {
                setField("audience")(e.currentTarget.value);
              }}
              placeholder="Quem é o cliente final: perfil, dor, contexto"
              value={form.audience}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="brief-voice">
                Tom da marca
                <MissingMark show={!form.voice.trim()} />
              </FieldLabel>
              <Input
                autoComplete="off"
                id="brief-voice"
                onChange={(e) => {
                  setField("voice")(e.currentTarget.value);
                }}
                placeholder="Ex: descontraído e próximo"
                value={form.voice}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brief-palette">
                Cores da marca
                <MissingMark show={!form.palette.trim()} />
              </FieldLabel>
              <Input
                autoComplete="off"
                id="brief-palette"
                onChange={(e) => {
                  setField("palette")(e.currentTarget.value);
                }}
                placeholder="Ex: #E11D48, off-white"
                value={form.palette}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="brief-references">
              Referências de marca
              <MissingMark show={!form.references.trim()} />
            </FieldLabel>
            <Textarea
              autoComplete="off"
              className="min-h-20"
              id="brief-references"
              onChange={(e) => {
                setField("references")(e.currentTarget.value);
              }}
              placeholder="Marcas ou estilos que inspiram você"
              value={form.references}
            />
          </Field>

          <div className="flex justify-end">
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

type CompanyBriefFormProps = {
  companyId: string;
  initialData?: CompanyResponse;
};

const CompanyBriefForm = ({ companyId, initialData }: CompanyBriefFormProps) => {
  const { data, isPending } = useQuery({
    initialData,
    meta: { errorToast: "Falha ao carregar dados da empresa" },
    queryFn: fetchCompany,
    queryKey: companyQueryKey(companyId),
  });

  if (isPending || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sobre a empresa</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <BriefCard
      companyId={companyId}
      initial={data.company.brief}
      key={JSON.stringify(data.company.brief)}
    />
  );
};

export { CompanyBriefForm };
