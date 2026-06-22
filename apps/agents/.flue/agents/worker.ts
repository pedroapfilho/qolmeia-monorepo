import { createAgent } from "@flue/runtime";

import { getTemplate } from "@/db/template";
import { loadAgentInstance } from "@/db/ticket";
import { getSkill, type SkillContext, type UnknownSkill } from "@/skills/registry";
import { resolveSystemPrompt } from "@/team/resolve-system-prompt";

import { skillTool } from "../skill-tool";

// The Worker agents, ported onto Flue (replaces the WorkerAgent DO +
// WorkerJobWorkflow generate step). Each worker instance is template-driven: its
// model, system prompt, and skill set come from the D1 template, resolved at
// agent init (createAgent supports async initialize).
//
// The CF approval Workflow stays: `WorkerJobWorkflow`'s `waitForEvent` gate is
// kept as-is (highest-stakes, most-tested path). It dispatches a run to this
// agent for the deliverable, then gates it — the agent itself only produces
// work, it does not own the approval loop.
//
// Keyed by agent instance id (context.id), same as the DO.
const workerAgent = createAgent<unknown, Env>(async (context) => {
  const agentInstanceId = context.id;
  const instance = await loadAgentInstance(context.env.DB, agentInstanceId);
  if (!instance?.templateId) {
    throw new Error(`flue worker ${agentInstanceId}: agent_instance has no template`);
  }
  const template = await getTemplate(context.env.DB, instance.templateId);
  if (!template) {
    throw new Error(`flue worker ${agentInstanceId}: template ${instance.templateId} not found`);
  }
  const row = await context.env.DB.prepare("SELECT company_id FROM agent_instance WHERE id = ?")
    .bind(agentInstanceId)
    .first<{ company_id: string }>();
  if (!row?.company_id) {
    throw new Error(`flue worker ${agentInstanceId}: no company_id`);
  }

  const ctx: SkillContext = {
    agentInstanceId,
    companyId: row.company_id,
    env: context.env,
  };
  const tools = template.skillIds
    .map((id) => getSkill(id))
    .filter((skill): skill is UnknownSkill => skill !== undefined)
    .map((skill) => skillTool(skill, ctx));

  return {
    instructions: resolveSystemPrompt(instance, template),
    // template.model is the OpenRouter model id (e.g. "anthropic/claude-...").
    model: `openrouter/${template.model}`,
    tools,
  };
});

export default workerAgent;
