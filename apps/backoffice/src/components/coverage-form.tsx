"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import type { CoverageResponse } from "@repo/worker-api/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiSend, ApiError } from "@/lib/api-client";

type CoverageFormProps = {
  initial: CoverageResponse["assigned"];
  options: CoverageResponse["options"];
};

const disciplineLabel = (kind: string): string =>
  kind
    .split(/[\s_\-]+/v)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1))
    .join(" ");

const toggle = (set: ReadonlySet<string>, value: string): Set<string> => {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
};

const CoverageForm = ({ initial, options }: CoverageFormProps) => {
  const { refresh } = useRouter();
  const [companies, setCompanies] = useState<ReadonlySet<string>>(() => new Set(initial.companies));
  const [disciplines, setDisciplines] = useState<ReadonlySet<string>>(
    () => new Set(initial.disciplines),
  );
  const [submitting, setSubmitting] = useState(false);

  const seesEverything = companies.size === 0 && disciplines.size === 0;

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await apiSend("PUT", "/assignments/me", {
        companies: [...companies],
        disciplines: [...disciplines],
      });
      toast.success("Cobertura salva.");
      refresh();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}: ${error.body || "falha"}`
          : "Não foi possível salvar a cobertura.";
      toast.error(message);
    }
    setSubmitting(false);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-sm font-semibold text-foreground">Empresas</legend>
        <p className="text-xs text-muted-foreground">
          Marque as empresas que você revisa. Nenhuma marcada = todas.
        </p>
        {options.companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {options.companies.map((company) => {
              const checked = companies.has(company.id);
              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 transition-colors",
                    checked
                      ? "border-primary bg-highlight-surface ring-1 ring-primary/40"
                      : "border-border hover:border-input hover:bg-accent",
                  )}
                  key={company.id}
                >
                  <input
                    aria-label={company.name}
                    checked={checked}
                    className="size-4 accent-primary"
                    name="companies"
                    onChange={() => {
                      setCompanies((s) => toggle(s, company.id));
                    }}
                    type="checkbox"
                  />
                  <span className="text-sm font-medium text-foreground">{company.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-sm font-semibold text-foreground">Disciplinas</legend>
        <p className="text-xs text-muted-foreground">
          O tipo de trabalho que você revisa (pela especialidade do agente). Nenhuma marcada =
          todas.
        </p>
        {options.disciplines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma disciplina disponível ainda.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.disciplines.map((discipline) => {
              const checked = disciplines.has(discipline);
              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 transition-colors",
                    checked
                      ? "border-primary bg-highlight-surface ring-1 ring-primary/40"
                      : "border-border hover:border-input hover:bg-accent",
                  )}
                  key={discipline}
                >
                  <input
                    aria-label={disciplineLabel(discipline)}
                    checked={checked}
                    className="size-3.5 accent-primary"
                    name="disciplines"
                    onChange={() => {
                      setDisciplines((s) => toggle(s, discipline));
                    }}
                    type="checkbox"
                  />
                  <span className="text-sm font-medium text-foreground">
                    {disciplineLabel(discipline)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <output className="text-xs text-muted-foreground">
          {seesEverything
            ? "Sem filtro: você vê a fila inteira, de todas as empresas."
            : `Filtrando ${companies.size} empresa(s) e ${disciplines.size} disciplina(s).`}
        </output>
        <Button disabled={submitting} type="submit">
          {submitting ? "Salvando…" : "Salvar cobertura"}
        </Button>
      </div>
    </form>
  );
};

export { CoverageForm };
