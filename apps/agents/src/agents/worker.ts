import { createAgent } from "@flue/runtime";

import { getTemplate } from "#/db/template";
import { loadAgentInstance } from "#/db/ticket";
import { buildFlueTools } from "#/lib/skill-tool";
import type { SkillContext } from "#/skills/registry";
import { resolveSystemPrompt } from "#/team/resolve-system-prompt";

export default createAgent<unknown, Env>(async (context) => {
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

  return {
    instructions: resolveSystemPrompt(instance, template),
    model: `openrouter/${template.model}`,
    tools: await buildFlueTools(ctx, template.skillIds),
  };
});
