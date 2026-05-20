import type { ConnectorType } from "@repo/db";

type AgentTemplateDefinition = {
  canDelegateTo: ReadonlyArray<string>;
  compatibleInboundConnectorTypes: ReadonlyArray<ConnectorType>;
  compatibleOutboundConnectorTypes: ReadonlyArray<ConnectorType>;
  defaultBudgetCents: number;
  defaultEnabledSkillIds: ReadonlyArray<string>;
  defaultMission: string;
  defaultSystemPrompt: string;
  description: string;
  displayName: string;
  slug: string;
};

export type { AgentTemplateDefinition };
