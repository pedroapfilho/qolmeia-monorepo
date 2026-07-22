import { defineAgent } from "@flue/runtime";

import { getDb } from "#/db/client";
import { getTemplate } from "#/db/template";
import { loadAgentInstance } from "#/db/ticket";
import { buildFlueTools } from "#/lib/skill-tool";
import type { SkillContext } from "#/skills/registry";
import { resolveSystemPrompt } from "#/team/resolve-system-prompt";

export default defineAgent<Env>(async (context) => {
  const agentInstanceId = context.id;
  const db = getDb(context.env);
  const instance = await loadAgentInstance(db, agentInstanceId);
  if (!instance?.templateId) {
    throw new Error(`flue worker ${agentInstanceId}: agent_instance has no template`);
  }
  const template = await getTemplate(db, instance.templateId);
  if (!template) {
    throw new Error(`flue worker ${agentInstanceId}: template ${instance.templateId} not found`);
  }
  const row = await db.agentInstance.findUnique({
    select: { companyId: true },
    where: { id: agentInstanceId },
  });
  if (!row?.companyId) {
    throw new Error(`flue worker ${agentInstanceId}: no company_id`);
  }

  const ctx: SkillContext = {
    agentInstanceId,
    companyId: row.companyId,
    env: context.env,
  };

  return {
    instructions: resolveSystemPrompt(instance, template),
    model: `openrouter/${template.model}`,
    tools: await buildFlueTools(ctx, template.skillIds),
  };
});
