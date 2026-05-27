"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { Textarea } from "@repo/ui/components/textarea";
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

const MAX_FEEDBACK = 2000;

// Decision form for /approvals/[id]. POSTs to the agents Worker, refreshes
// the RSC list, and routes back to /approvals so the operator can keep
// triaging without a manual click.
const DecisionForm = ({ actionId }: DecisionFormProps) => {
  const router = useRouter();
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
      router.push("/approvals");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}: ${error.body || "falha"}`
          : "Não foi possível enviar a decisão.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-foreground">Decisão</legend>
        <div className="grid gap-2">
          {OPTIONS.map((opt) => {
            const inputId = `decision-${opt.value}`;
            const selected = decision === opt.value;
            return (
              <label
                aria-label={opt.label}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                    : "border-border hover:border-border/80 hover:bg-muted/40",
                )}
                htmlFor={inputId}
                key={opt.value}
              >
                <input
                  checked={selected}
                  className="mt-1 size-4 accent-primary"
                  id={inputId}
                  name="decision"
                  onChange={() => setDecision(opt.value)}
                  type="radio"
                  value={opt.value}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{opt.label}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label className="flex items-center justify-between" htmlFor="decision-feedback">
          <span className="text-sm font-medium text-foreground">
            Feedback{" "}
            <span
              className={cn(
                "ml-1 text-xs font-normal",
                feedbackRequired ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
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

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={submitting} size="lg" type="submit">
          {submitting ? "Enviando..." : "Enviar decisão"}
        </Button>
        <Button
          disabled={submitting}
          onClick={() => router.back()}
          size="lg"
          type="button"
          variant="ghost"
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
};

export { DecisionForm };
