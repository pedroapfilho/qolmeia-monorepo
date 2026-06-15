"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import { Sparkles } from "lucide-react";
import { useState } from "react";

type Template = {
  description: string;
  displayName: string;
  id: string;
  workerKind: string;
};

type OnboardingActionsProps = {
  agentsUrl: string;
  companyId: string;
  sessionToken: string;
  templates: ReadonlyArray<Template>;
};

// P5 minimum: a flat list of available templates with a "Confirmar Time"
// button. The user toggles which specialists they want; one POST materializes
// the Team.
const OnboardingActions = ({
  agentsUrl,
  companyId,
  sessionToken,
  templates,
}: OnboardingActionsProps) => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(templates.map((t) => t.id)),
  );
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const handleConfirm = async () => {
    if (selected.size === 0) {
      toast.error("Escolha pelo menos um especialista.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${agentsUrl}/api/teams/${companyId}/confirm`, {
        body: JSON.stringify({ templateIds: [...selected] }),
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.text();
        toast.error(`Não foi possível confirmar: ${body.slice(0, 120)}`);
        return;
      }
      toast.success("Time confirmado! Redirecionando…");
      globalThis.location.assign("/");
    } catch {
      toast.error("Erro ao confirmar o Time. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Especialistas disponíveis</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Escolha quem você quer no seu Time e clique em Confirmar.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {templates.map((t) => {
            const checked = selected.has(t.id);
            const inputId = `template-${t.id}`;
            return (
              <li key={t.id}>
                <label
                  aria-label={t.displayName}
                  className={cn(
                    "flex h-full cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    checked
                      ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                      : "border-border hover:border-border/80 hover:bg-muted/40",
                  )}
                  htmlFor={inputId}
                >
                  <input
                    aria-label={t.displayName}
                    checked={checked}
                    className="mt-1 size-4 accent-primary"
                    id={inputId}
                    onChange={() => toggle(t.id)}
                    type="checkbox"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{t.displayName}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {t.description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {selected.size} de {templates.length} selecionado{templates.length === 1 ? "" : "s"}
          </span>
          <Button
            disabled={submitting || selected.size === 0}
            onClick={handleConfirm}
            size="lg"
            type="button"
          >
            {submitting ? "Confirmando…" : "Confirmar Time"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export { OnboardingActions };
