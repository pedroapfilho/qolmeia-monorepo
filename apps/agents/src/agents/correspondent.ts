"use agent";
import {
  type AgentProps,
  useAgentStart,
  useModel,
  usePersistentState,
  useTool,
} from "@flue/runtime";
import { env } from "cloudflare:workers";

import { buildFlueTools } from "#/lib/skill-tool";
import { loadSkillOverlays, type SkillContext, type SkillOverlayMap } from "#/skills/registry";

const CORRESPONDENT_SKILLS = [
  "rememberFact",
  "recallMemory",
  "delegateToWorker",
  "extractBrief",
  "listAssets",
  "readAsset",
  "saveAsset",
  "webSearch",
  "fetchUrl",
];

const CORRESPONDENT_INSTRUCTIONS = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional, como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). Diga ao cliente que o especialista vai cuidar disso e que você avisa quando o resultado estiver pronto; não prometa prazo específico. O cliente NUNCA precisa aprovar nada: aprovações são feitas internamente pela equipe da Qolmeia, e a entrega final aparece no chat automaticamente quando estiver pronta.

Ao mostrar imagens geradas, inclua a URL no formato markdown ![descrição curta](URL) para que apareça inline no chat.

Use recallMemory no início de pedidos relevantes para lembrar o que já sabe sobre o cliente, e rememberFact para guardar fatos novos importantes.`;

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

// Flue 2 cannot read the beta runtime's persisted schema, so this fresh export
// intentionally derives FlueCorrespondentV2Agent. Keep this identity stable
// after the v3 reset migration in wrangler.jsonc is deployed.
export function CorrespondentV2({ id }: AgentProps): string {
  // Overlays (operator description overrides + the per-skill kill switch) come
  // from Postgres, but agent renders are synchronous, so the read happens at the
  // intake seam and the render works off the persisted snapshot. The snapshot
  // is refreshed for every delivery; runSkill also rechecks the kill switch at
  // invocation time because state writes become visible only on the next render.
  const [overlays, setOverlays] = usePersistentState<SkillOverlayMap | null>("skillOverlays", null);
  useAgentStart(async () => {
    setOverlays(await loadSkillOverlays(env, CORRESPONDENT_SKILLS));
  });

  useModel(`openrouter/${env.CORRESPONDENT_MODEL || DEFAULT_MODEL}`);

  const ctx: SkillContext = { agentInstanceId: `corr-${id}`, companyId: id, env };
  for (const skillTool of buildFlueTools(ctx, CORRESPONDENT_SKILLS, overlays)) {
    useTool(skillTool);
  }

  return CORRESPONDENT_INSTRUCTIONS;
}
