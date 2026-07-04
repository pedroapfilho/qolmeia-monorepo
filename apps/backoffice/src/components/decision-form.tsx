"use client";

import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiSend, ApiError } from "@/lib/api-client";
import type { DecisionOutcome } from "@/lib/api-types";

type DecisionFormProps = {
  actionId: string;
};

const PLACEHOLDER: Record<DecisionOutcome, string> = {
  approved: "Comentário opcional ao especialista.",
  changes_requested: "Diga o que precisa mudar — o especialista vai usar para revisar.",
  rejected: "Diga por que está rejeitando — vai virar memória do agente.",
};

const OPTIONS: ReadonlyArray<{
  description: string;
  label: string;
  value: DecisionOutcome;
}> = [
  {
    description: "Executa a proposta exatamente como foi apresentada.",
    label: "Aprovar",
    value: "approved",
  },
  {
    description: "Devolve para o especialista com seu pedido de ajuste.",
    label: "Pedir ajustes",
    value: "changes_requested",
  },
  {
    description: "Encerra a proposta. O especialista é notificado.",
    label: "Rejeitar",
    value: "rejected",
  },
];

const SUBMIT_LABEL: Record<DecisionOutcome, string> = {
  approved: "Aprovar e executar",
  changes_requested: "Pedir ajustes",
  rejected: "Rejeitar ação",
};

const MAX_FEEDBACK = 2000;

const DecisionForm = ({ actionId }: DecisionFormProps) => {
  const { push, refresh } = useRouter();
  const [decision, setDecision] = useState<DecisionOutcome>("approved");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const feedbackRequired = decision !== "approved";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) {
      return;
    }
    if (feedbackRequired && feedback.trim().length === 0) {
      toast.error("Adicione um motivo para pedir ajustes ou rejeitar.");
      return;
    }
    setSubmitting(true);
    try {
      await apiSend("POST", `/actions/${actionId}/decide`, {
        decision,
        feedback: feedback.trim() || undefined,
      });
      const successCopy: Record<typeof decision, string> = {
        approved: "Aprovado. O especialista vai executar.",
        changes_requested: "Ajustes pedidos. Especialista notificado.",
        rejected: "Rejeitado.",
      };
      toast.success(successCopy[decision]);
      push("/approvals");
      refresh();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}: ${error.body || "falha"}`
          : "Não foi possível enviar a decisão.";
      toast.error(message);
    }
    setSubmitting(false);
  };

  return (
    <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Decisão</legend>
        {OPTIONS.map((opt) => {
          const inputId = `decision-${opt.value}`;
          const selected = decision === opt.value;
          return (
            <label
              aria-label={opt.label}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                selected
                  ? "border-primary bg-highlight-surface ring-1 ring-primary/40"
                  : "border-border hover:border-input hover:bg-accent",
              )}
              htmlFor={inputId}
              key={opt.value}
            >
              <input
                aria-label={opt.label}
                checked={selected}
                className="sr-only"
                id={inputId}
                name="decision"
                onChange={() => setDecision(opt.value)}
                type="radio"
                value={opt.value}
              />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
                  selected ? "border-primary" : "border-input",
                )}
              >
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {opt.description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center justify-between" htmlFor="decision-feedback">
          <span className="text-sm font-medium text-foreground">
            Observações{" "}
            <span
              className={cn(
                "ml-1 text-xs font-normal",
                feedbackRequired ? "text-warning-surface-foreground" : "text-muted-foreground",
              )}
            >
              {feedbackRequired ? "(obrigatório)" : "(opcional)"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {feedback.length}/{MAX_FEEDBACK}
          </span>
        </label>
        <Textarea
          id="decision-feedback"
          maxLength={MAX_FEEDBACK}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={PLACEHOLDER[decision]}
          value={feedback}
        />
      </div>

      <Button className="w-full" disabled={submitting} size="lg" type="submit">
        {submitting ? "Enviando…" : SUBMIT_LABEL[decision]}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        A decisão retoma o fluxo de trabalho do agente.
      </p>
    </form>
  );
};

export { DecisionForm };
