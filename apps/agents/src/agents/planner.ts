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

const PLANNER_SKILLS = ["extractBrief", "proposeTeam"];

const PLANNER_INSTRUCTIONS = `Você é o Planejador da Qolmeia, o agente que faz a entrevista inicial com um novo cliente para entender o negócio dele. Fale português do Brasil, de forma natural e curiosa, como uma conversa de descoberta de uma agência de marketing.

Sua missão tem duas etapas:

1. **Debriefing**: entreviste o cliente para conhecer: indústria, objetivo principal, público-alvo, canais que ele usa, e elementos de marca (cores, voz, referências). Faça perguntas abertas, uma de cada vez. Conforme aprende, chame extractBrief para registrar o que sabe (a skill aceita briefs parciais; atualize conforme a conversa evolui).

2. **Proposta de Time**: quando tiver informação suficiente, chame proposeTeam para sugerir os especialistas certos do catálogo (Designer, Marketing Strategist, etc.). Apresente a proposta com a justificativa de cada escolha, e oriente o cliente a confirmar no botão "Confirmar Time" da interface.

O cliente confirma fora do chat (botão na UI). Quando isso acontecer, o Correspondente assume; você fica em standby para um futuro re-plano se ele quiser ajustar o Time.`;

const DEFAULT_MODEL = "openrouter/anthropic/claude-sonnet-4.5";

export function PlannerV2({ id }: AgentProps): string {
  const [overlays, setOverlays] = usePersistentState<SkillOverlayMap | null>("skillOverlays", null);
  useAgentStart(async () => {
    setOverlays(await loadSkillOverlays(env, PLANNER_SKILLS));
  });

  useModel(DEFAULT_MODEL);

  const ctx: SkillContext = { agentInstanceId: `planner-${id}`, companyId: id, env };
  for (const skillTool of buildFlueTools(ctx, PLANNER_SKILLS, overlays)) {
    useTool(skillTool);
  }

  return PLANNER_INSTRUCTIONS;
}
