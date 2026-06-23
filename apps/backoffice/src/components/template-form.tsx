"use client";

import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { z } from "zod";

import { BackLink } from "@/components/back-link";
import { ApiError } from "@/lib/api-client";
import type { SkillCatalogEntry, Template, TemplateInput } from "@/lib/api-types";
import {
  createTemplate,
  fetchSkillCatalog,
  setTemplateStatus,
  templateKeys,
  updateTemplate,
} from "@/lib/templates-api";

type TemplateFormProps = {
  // Present when editing; absent when creating.
  initial?: Template;
};

type FieldKey =
  | "defaultActionType"
  | "defaultPolicies"
  | "description"
  | "displayName"
  | "model"
  | "systemPrompt"
  | "workerKind";

// `defaultPolicies` is edited as raw JSON for v1. The schema validates it
// parses to a flat string→string record before submit.
const policiesRecordSchema = z.record(z.string(), z.string());

const formSchema = z.object({
  defaultActionType: z.string().trim().min(1, "Informe o tipo de ação."),
  defaultPolicies: z
    .string()
    .trim()
    .refine((raw) => {
      if (raw === "") {
        return true;
      }
      try {
        return policiesRecordSchema.safeParse(JSON.parse(raw)).success;
      } catch {
        return false;
      }
    }, "JSON inválido. Use um objeto { tipoDeAção: política }."),
  description: z.string().trim().min(1, "Informe uma descrição."),
  displayName: z.string().trim().min(1, "Informe o nome de exibição."),
  model: z.string().trim().min(1, "Informe o modelo."),
  systemPrompt: z.string().trim().min(1, "Informe o prompt do sistema."),
  workerKind: z.string().trim().min(1, "Informe o tipo (worker kind)."),
});

const parsePolicies = (raw: string): Record<string, string> => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {};
  }
  return policiesRecordSchema.parse(JSON.parse(trimmed));
};

type SkillPickerProps = {
  busy: boolean;
  loading: boolean;
  onToggle: (id: string) => void;
  selected: ReadonlyArray<string>;
  skills: ReadonlyArray<SkillCatalogEntry>;
};

const SkillPicker = ({ busy, loading, onToggle, selected, skills }: SkillPickerProps) => {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando habilidades…</p>;
  }
  if (skills.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma habilidade disponível.</p>;
  }
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {skills.map((skill) => {
        const checked = selected.includes(skill.id);
        return (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
              checked
                ? "border-primary bg-highlight-surface ring-1 ring-primary/40"
                : "border-border hover:border-input hover:bg-accent",
            )}
            key={skill.id}
          >
            <input
              aria-label={skill.displayName}
              checked={checked}
              className="mt-0.5 size-4 accent-primary"
              disabled={busy}
              onChange={() => onToggle(skill.id)}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{skill.displayName}</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                {skill.id}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
};

const TemplateForm = ({ initial }: TemplateFormProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const policiesFieldId = useId();

  const isEdit = initial !== undefined;

  const [values, setValues] = useState({
    defaultActionType: initial?.defaultActionType ?? "worker_deliverable",
    defaultPolicies: initial ? JSON.stringify(initial.defaultPolicies, null, 2) : "{}",
    description: initial?.description ?? "",
    displayName: initial?.displayName ?? "",
    model: initial?.model ?? "",
    systemPrompt: initial?.systemPrompt ?? "",
    workerKind: initial?.workerKind ?? "",
  });
  const [skillIds, setSkillIds] = useState<ReadonlyArray<string>>(initial?.skillIds ?? []);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const { data: skillsData, isLoading: skillsLoading } = useQuery({
    queryFn: fetchSkillCatalog,
    queryKey: templateKeys.skills,
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (input: TemplateInput) =>
      isEdit ? updateTemplate(initial.id, input) : createTemplate(input),
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}: ${error.body || "falha ao salvar"}`
          : "Não foi possível salvar o modelo.";
      toast.error(message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      toast.success(isEdit ? "Modelo atualizado." : "Modelo criado.");
      router.push("/templates");
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: Template["status"]) => setTemplateStatus(initial?.id ?? "", status),
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}: ${error.body || "falha"}`
          : "Não foi possível alterar o status.";
      toast.error(message);
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      toast.success(
        data.template.status === "retired" ? "Modelo desativado." : "Modelo reativado.",
      );
      router.refresh();
    },
  });

  const setField = (key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSkill = (id: string) => {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const focusFirstError = (firstKey: FieldKey) => {
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${firstKey}"]`);
    el?.focus();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = formSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<FieldKey, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey;
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      const firstKey = parsed.error.issues[0]?.path[0] as FieldKey | undefined;
      if (firstKey) {
        focusFirstError(firstKey);
      }
      return;
    }
    setErrors({});
    saveMutation.mutate({
      defaultActionType: parsed.data.defaultActionType,
      defaultPolicies: parsePolicies(parsed.data.defaultPolicies),
      description: parsed.data.description,
      displayName: parsed.data.displayName,
      model: parsed.data.model,
      skillIds,
      systemPrompt: parsed.data.systemPrompt,
      workerKind: parsed.data.workerKind,
    });
  };

  const handleToggleStatus = () => {
    if (!initial) {
      return;
    }
    statusMutation.mutate(initial.status === "retired" ? "active" : "retired");
  };

  const busy = saveMutation.isPending;
  const skills = skillsData?.items ?? [];
  const editLabel = isEdit ? "Salvar alterações" : "Criar modelo";
  const submitLabel = busy ? "Salvando…" : editLabel;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/templates">Modelos</BackLink>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {isEdit ? "Editar modelo" : "Novo modelo"}
        </h1>
        {isEdit ? (
          <Button
            disabled={statusMutation.isPending}
            onClick={handleToggleStatus}
            type="button"
            variant="outline"
          >
            {initial.status === "retired" ? "Reativar" : "Desativar"}
          </Button>
        ) : null}
      </header>

      <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit} ref={formRef}>
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="displayName">Nome de exibição</FieldLabel>
                <Input
                  disabled={busy}
                  id="displayName"
                  name="displayName"
                  onChange={(e) => setField("displayName", e.target.value)}
                  value={values.displayName}
                />
                <FieldError errors={errors.displayName ? [errors.displayName] : undefined} />
              </Field>

              <Field>
                <FieldLabel htmlFor="workerKind">Tipo (worker kind)</FieldLabel>
                <Input
                  autoComplete="off"
                  disabled={busy}
                  id="workerKind"
                  name="workerKind"
                  onChange={(e) => setField("workerKind", e.target.value)}
                  placeholder="seo-researcher"
                  value={values.workerKind}
                />
                <FieldError errors={errors.workerKind ? [errors.workerKind] : undefined} />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="description">Descrição</FieldLabel>
              <Input
                disabled={busy}
                id="description"
                name="description"
                onChange={(e) => setField("description", e.target.value)}
                value={values.description}
              />
              <FieldError errors={errors.description ? [errors.description] : undefined} />
            </Field>

            <Field>
              <FieldLabel htmlFor="systemPrompt">Prompt do sistema</FieldLabel>
              <Textarea
                className="min-h-40 font-mono text-[13px]"
                disabled={busy}
                id="systemPrompt"
                name="systemPrompt"
                onChange={(e) => setField("systemPrompt", e.target.value)}
                value={values.systemPrompt}
              />
              <FieldError errors={errors.systemPrompt ? [errors.systemPrompt] : undefined} />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="model">Modelo (LLM)</FieldLabel>
                <Input
                  autoComplete="off"
                  disabled={busy}
                  id="model"
                  name="model"
                  onChange={(e) => setField("model", e.target.value)}
                  placeholder="openai/gpt-4o-mini"
                  value={values.model}
                />
                <FieldError errors={errors.model ? [errors.model] : undefined} />
              </Field>

              <Field>
                <FieldLabel htmlFor="defaultActionType">Tipo de ação padrão</FieldLabel>
                <Input
                  autoComplete="off"
                  disabled={busy}
                  id="defaultActionType"
                  name="defaultActionType"
                  onChange={(e) => setField("defaultActionType", e.target.value)}
                  value={values.defaultActionType}
                />
                <FieldError
                  errors={errors.defaultActionType ? [errors.defaultActionType] : undefined}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2.5">
              <legend className="text-sm font-semibold text-foreground">Habilidades</legend>
              <p className="text-xs text-muted-foreground">
                As habilidades (skills) que este especialista pode usar.
              </p>
              <SkillPicker
                busy={busy}
                loading={skillsLoading}
                onToggle={toggleSkill}
                selected={skillIds}
                skills={skills}
              />
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={policiesFieldId}>Políticas padrão (JSON)</FieldLabel>
              <FieldDescription>
                Objeto {`{ tipoDeAção: política }`}. Vazio = nenhuma política.
              </FieldDescription>
              <Textarea
                className="min-h-28 font-mono text-[13px]"
                disabled={busy}
                id={policiesFieldId}
                name="defaultPolicies"
                onChange={(e) => setField("defaultPolicies", e.target.value)}
                spellCheck={false}
                value={values.defaultPolicies}
              />
              <FieldError errors={errors.defaultPolicies ? [errors.defaultPolicies] : undefined} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button disabled={busy} type="submit">
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
};

export { TemplateForm };
