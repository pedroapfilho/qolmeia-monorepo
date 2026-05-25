"use client";

import { toast } from "@repo/ui/components/sonner";
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
// the Team. A nicer UX (Planner emitting the proposal via setState, the panel
// highlighting recommended ones) is a future polish.
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
      const response = await fetch(
        `${agentsUrl}/api/teams/${companyId}/confirm?cf_session=${sessionToken}`,
        {
          body: JSON.stringify({ templateIds: [...selected] }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
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
    <div className="border-t border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">Especialistas disponíveis</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Escolha quem você quer no seu Time e clique em Confirmar.
      </p>
      <ul className="mb-3 space-y-2">
        {templates.map((t) => (
          <li key={t.id}>
            {/* Nested input is the implicit label-control association; spans
                carry the visible text. */}
            {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label className="flex items-start gap-2 text-sm">
              <input
                checked={selected.has(t.id)}
                className="mt-1"
                onChange={() => toggle(t.id)}
                type="checkbox"
              />
              <span>
                <span className="font-medium">{t.displayName}</span>
                <span className="block text-xs text-muted-foreground">{t.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        disabled={submitting || selected.size === 0}
        onClick={handleConfirm}
        type="button"
      >
        {submitting ? "Confirmando…" : "Confirmar Time"}
      </button>
    </div>
  );
};

export { OnboardingActions };
