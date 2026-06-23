import { createAgent } from "@flue/runtime";
import type { MiddlewareHandler } from "hono";

import { listAssetsSkill, readAssetSkill, saveAssetSkill } from "#/skills/assets";
import { delegateToWorkerSkill } from "#/skills/delegate-to-worker";
import { extractBriefSkill } from "#/skills/extract-brief";
import { fetchUrlSkill } from "#/skills/fetch-url";
import { recallMemorySkill } from "#/skills/recall-memory";
import type { SkillContext } from "#/skills/registry";
import { rememberFactSkill } from "#/skills/remember-fact";
import { webSearchSkill } from "#/skills/web-search";

import { skillTool } from "../skill-tool";

// The Correspondent, ported onto Flue (replaces the AIChatAgent in
// agents/correspondent.ts). Flue's runtime drives the chat + tool loop. The
// recent-turns buffer and the always-injected memory/brief block are replaced
// by: Flue's session history for short-term context, and the recallMemory tool
// for long-term recall (the harness calls it when relevant). The deliverable
// hand-off (presentResult) and brief seeding stay on the Workflow/team-confirm
// paths, which call into the agent rather than the chat loop.
//
// Keyed per company: agent instance id = company id (/agents/correspondent/<companyId>).

// Was BASE_SYSTEM_PROMPT in agents/correspondent-context.ts. The dynamic brief
// block + remembered-facts block are now reached via the recallMemory tool.
const CORRESPONDENT_INSTRUCTIONS = `Você é o Correspondente da Qolmeia, o ponto único de contato de uma agência de IA para negócios. Fale português do Brasil, de forma calorosa, direta e profissional — como um gerente de conta atencioso.

Você tem um Time de especialistas. Quando o pedido exige uma especialidade (criar imagens, posts visuais, materiais de design), use a skill delegateToWorker com o workerKind apropriado (ex: "designer"). Diga ao cliente que o especialista vai cuidar disso e que você avisa quando o resultado estiver pronto — não prometa prazo específico. O cliente NUNCA precisa aprovar nada: aprovações são feitas internamente pela equipe da Qolmeia, e a entrega final aparece no chat automaticamente quando estiver pronta.

Ao mostrar imagens geradas, inclua a URL no formato markdown ![descrição curta](URL) para que apareça inline no chat.

Use recallMemory no início de pedidos relevantes para lembrar o que já sabe sobre o cliente, e rememberFact para guardar fatos novos importantes.`;

// OpenRouter is registered in flue/provider.ts.
const DEFAULT_MODEL = "openrouter/anthropic/claude-sonnet-4.5";

export default createAgent<unknown, Env>((context) => {
  const ctx: SkillContext = {
    agentInstanceId: `corr-${context.id}`,
    companyId: context.id,
    env: context.env,
  };

  return {
    instructions: CORRESPONDENT_INSTRUCTIONS,
    model: DEFAULT_MODEL,
    tools: [
      skillTool(rememberFactSkill, ctx),
      skillTool(recallMemorySkill, ctx),
      skillTool(delegateToWorkerSkill, ctx),
      skillTool(extractBriefSkill, ctx),
      skillTool(listAssetsSkill, ctx),
      skillTool(readAssetSkill, ctx),
      skillTool(saveAssetSkill, ctx),
      skillTool(webSearchSkill, ctx),
      skillTool(fetchUrlSkill, ctx),
    ],
  };
});

// Exposes the agent over HTTP at /agents/<name>/:id. Pass-through for now;
// the CUSTOMER session + tenant check will gate access here.
export const route: MiddlewareHandler = (_c, next) => next();
