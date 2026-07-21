import { defineAgent } from "@flue/runtime";

import { buildFlueTools } from "#/lib/skill-tool";
import type { SkillContext } from "#/skills/registry";

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

const CORRESPONDENT_INSTRUCTIONS = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). Diga ao cliente que o especialista vai cuidar disso e que você avisa quando o resultado estiver pronto — não prometa prazo específico. O cliente NUNCA precisa aprovar nada: aprovações são feitas internamente pela equipe da Qolmeia, e a entrega final aparece no chat automaticamente quando estiver pronta.

Ao mostrar imagens geradas, inclua a URL no formato markdown ![descrição curta](URL) para que apareça inline no chat.

Use recallMemory no início de pedidos relevantes para lembrar o que já sabe sobre o cliente, e rememberFact para guardar fatos novos importantes.`;

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export default defineAgent<Env>(async (context) => {
  const ctx: SkillContext = {
    agentInstanceId: `corr-${context.id}`,
    companyId: context.id,
    env: context.env,
  };

  return {
    instructions: CORRESPONDENT_INSTRUCTIONS,
    model: `openrouter/${context.env.CORRESPONDENT_MODEL || DEFAULT_MODEL}`,
    tools: await buildFlueTools(ctx, CORRESPONDENT_SKILLS),
  };
});

export { requireCustomerAgent as route } from "#/lib/agent-route-auth";
