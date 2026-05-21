import type { PrismaClient } from "@repo/db";

import { ensureAgentInstance } from "./agent-instance";

// Idempotently ensures a Telegram ConnectorInstance has the Controller wired
// as its INBOUND handler via AgentConnectorBinding. Called both on first
// contact (when a new ConnectorInstance is created) and as a backfill for
// existing rows that predate AgentConnectorBinding-driven routing.
//
// Phase 5 §7: inbound routing reads bindings where
//   connectorInstanceId = X AND direction IN (INBOUND, BOTH).
// For v0, exactly one binding (Controller) is expected per Telegram chat.
const ensureInboundBindingForTelegramConnector = async (args: {
  connectorInstanceId: string;
  orgId: string;
  prisma: Pick<PrismaClient, "agentConnectorBinding" | "agentInstance">;
}): Promise<void> => {
  const agent = await ensureAgentInstance({
    orgId: args.orgId,
    prisma: args.prisma,
    templateSlug: "controller",
  });

  await args.prisma.agentConnectorBinding.upsert({
    create: {
      agentInstanceId: agent.id,
      connectorInstanceId: args.connectorInstanceId,
      direction: "INBOUND",
    },
    update: {},
    where: {
      agentInstanceId_connectorInstanceId_direction: {
        agentInstanceId: agent.id,
        connectorInstanceId: args.connectorInstanceId,
        direction: "INBOUND",
      },
    },
  });
};

export { ensureInboundBindingForTelegramConnector };
