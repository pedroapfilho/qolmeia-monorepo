import { type LanguageModel, stepCountIs, streamText } from "ai";

import { logActivity } from "@/activity/log";
import { buildSystemPrompt, loadBriefContext } from "@/agents/correspondent-context";

// The Correspondent's weekly proactive "suggest next work" outreach. The cron
// sweep (scheduled.ts) wakes each active company's Correspondent DO, which runs
// this to decide — independently and idempotently — whether to message the
// customer with concrete deliverable ideas drawn from the brief.

const PROACTIVE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const PROACTIVE_SEED = "Inicie uma sugestão proativa de trabalho para esta semana.";

const PROACTIVE_ADDENDUM = `Esta é uma mensagem proativa que VOCÊ está iniciando — o cliente não perguntou nada agora. Com base no brief da empresa, sugira de 2 a 3 entregas concretas e específicas para esta semana (por exemplo: posts para redes, peças de design, ações de marketing). Seja breve e caloroso, conecte cada ideia ao negócio do cliente, e convide-o a confirmar para você já acionar o especialista. Não chame ferramentas agora.`;

type ProactiveOutcome = { reason: string; status: "skipped" } | { status: "suggested" };
type PreparedProactive = { reason: string; status: "skipped" } | { status: "ready"; text: string };

// Pure eligibility gate — unit-testable without D1 or a model.
const proactiveGate = (input: {
  isComplete: boolean;
  lastSuggestedAt: number | null;
  now: number;
}): { ok: boolean; reason: string } => {
  if (!input.isComplete) {
    return { ok: false, reason: "brief incomplete" };
  }
  if (input.lastSuggestedAt !== null && input.now - input.lastSuggestedAt < PROACTIVE_INTERVAL_MS) {
    return { ok: false, reason: "suggested recently" };
  }
  return { ok: true, reason: "" };
};

const lastProactiveSuggestionAt = async (
  env: Env,
  companyId: string,
): Promise<number | null> => {
  const row = await env.DB.prepare(
    `SELECT MAX(created_at) AS at FROM activity_log
       WHERE company_id = ? AND type = 'WORKER_PROACTIVE_SUGGESTION'`,
  )
    .bind(companyId)
    .first<{ at: number | null }>();
  return row?.at ?? null;
};

// Decides eligibility (brief complete + not suggested this week) and, when
// eligible, generates the proactive message text. The DO owns persistence and
// broadcast — this returns text only.
const prepareProactiveSuggestion = async (
  env: Env,
  model: LanguageModel,
  companyId: string,
): Promise<PreparedProactive> => {
  const briefContext = await loadBriefContext(env, companyId);
  const gate = proactiveGate({
    isComplete: briefContext.completeness.isComplete,
    lastSuggestedAt: await lastProactiveSuggestionAt(env, companyId),
    now: Date.now(),
  });
  if (!gate.ok) {
    return { reason: gate.reason, status: "skipped" };
  }

  const result = streamText({
    messages: [{ content: PROACTIVE_SEED, role: "user" }],
    model,
    stopWhen: stepCountIs(1),
    system: `${buildSystemPrompt([], briefContext)}\n\n${PROACTIVE_ADDENDUM}`,
  });
  const generated = await result.text;
  const text = generated.trim();
  if (!text) {
    return { reason: "empty generation", status: "skipped" };
  }
  return { status: "ready", text };
};

const recordProactiveSuggestion = async (env: Env, companyId: string): Promise<void> => {
  await logActivity(env, {
    companyId,
    refId: `corr-${companyId}`,
    refType: "agent_instance",
    summary: "Sugestão proativa de trabalho enviada ao cliente.",
    type: "WORKER_PROACTIVE_SUGGESTION",
  });
};

export {
  PROACTIVE_INTERVAL_MS,
  prepareProactiveSuggestion,
  proactiveGate,
  recordProactiveSuggestion,
};
export type { PreparedProactive, ProactiveOutcome };
