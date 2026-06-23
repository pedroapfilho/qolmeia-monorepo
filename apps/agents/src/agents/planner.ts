import { createAgent } from "@flue/runtime";

import { skillTool } from "#/lib/skill-tool";
import { extractBriefSkill } from "#/skills/extract-brief";
import { proposeTeamSkill } from "#/skills/propose-team";
import type { SkillContext } from "#/skills/registry";

// The Planner, ported onto Flue (replaces the hand-rolled AIChatAgent in
// agents/planner.ts). Flue's runtime drives the multi-turn debrief + tool-call
// loop, so the manual onChatMessage/streamText/stepCountIs/recent-turns wiring
// is gone — we just declare model + instructions + tools.
//
// Keyed per company: the agent instance id IS the company id (addressed at
// /agents/planner/<companyId>, same as the DO naming). Tools close over the
// Worker `env` + company id, reusing the existing skill `execute`.

// Was BASE_SYSTEM_PROMPT in agents/planner.ts.
const PLANNER_INSTRUCTIONS = `Você é o Planejador da Qolmeia — o agente que faz a entrevista inicial com um novo cliente para entender o negócio dele. Fale português do Brasil, de forma natural e curiosa, como uma conversa de descoberta de uma agência de marketing.

Sua missão tem duas etapas:

1. **Debriefing** — entreviste o cliente para conhecer: indústria, objetivo principal, público-alvo, canais que ele usa, e elementos de marca (cores, voz, referências). Faça perguntas abertas, uma de cada vez. Conforme aprende, chame extractBrief para registrar o que sabe (a skill aceita briefs parciais — atualize conforme a conversa evolui).

2. **Proposta de Time** — quando tiver informação suficiente, chame proposeTeam para sugerir os especialistas certos do catálogo (Designer, Marketing Strategist, etc.). Apresente a proposta com a justificativa de cada escolha, e oriente o cliente a confirmar no botão "Confirmar Time" da interface.

O cliente confirma fora do chat (botão na UI). Quando isso acontecer, o Correspondente assume — você fica em standby para um futuro re-plano se ele quiser ajustar o Time.`;

// OpenRouter is registered in provider.ts; model strings are `openrouter/<model>`.
const DEFAULT_MODEL = "openrouter/anthropic/claude-sonnet-4.5";

export default createAgent<unknown, Env>((context) => {
  const ctx: SkillContext = {
    agentInstanceId: `planner-${context.id}`,
    companyId: context.id,
    env: context.env,
  };

  return {
    instructions: PLANNER_INSTRUCTIONS,
    model: DEFAULT_MODEL,
    tools: [skillTool(extractBriefSkill, ctx), skillTool(proposeTeamSkill, ctx)],
  };
});

// Exposes the agent over HTTP at /agents/planner/:id, gated to the owning CUSTOMER.
export { requireCustomerAgent as route } from "#/lib/agent-route-auth";
