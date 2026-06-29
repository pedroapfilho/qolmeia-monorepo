import { logActivity } from "#/activity/log";

const PROACTIVE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const PROACTIVE_PROMPT = `Esta é uma mensagem proativa que VOCÊ está iniciando — o cliente não perguntou nada agora. Com base no brief da empresa, sugira de 2 a 3 entregas concretas e específicas para esta semana (por exemplo: posts para redes, peças de design, ações de marketing). Seja breve e caloroso, conecte cada ideia ao negócio do cliente, e convide-o a confirmar para você já acionar o especialista.`;

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

const lastProactiveSuggestionAt = async (env: Env, companyId: string): Promise<number | null> => {
  const row = await env.DB.prepare(
    `SELECT MAX(created_at) AS at FROM activity_log
       WHERE company_id = ? AND type = 'WORKER_PROACTIVE_SUGGESTION'`,
  )
    .bind(companyId)
    .first<{ at: number | null }>();
  return row?.at ?? null;
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
  lastProactiveSuggestionAt,
  PROACTIVE_INTERVAL_MS,
  PROACTIVE_PROMPT,
  proactiveGate,
  recordProactiveSuggestion,
};
