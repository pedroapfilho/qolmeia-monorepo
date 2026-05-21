import type { ConnectorType } from "@repo/db";

type AgentTemplateDefinition = {
  canDelegateTo: ReadonlyArray<string>;
  compatibleInboundConnectorTypes: ReadonlyArray<ConnectorType>;
  compatibleOutboundConnectorTypes: ReadonlyArray<ConnectorType>;
  defaultBudgetCents: number;
  defaultEnabledSkillIds: ReadonlyArray<string>;
  defaultMission: string;
  // OpenRouter model id (e.g. "openai/gpt-5.4-mini") used by this template's
  // agent instances unless overridden per-instance via AgentInstance.modelOverride.
  defaultModel: string;
  defaultSystemPrompt: string;
  description: string;
  displayName: string;
  slug: string;
};

export type { AgentTemplateDefinition };
