import "dotenv/config";

import { prisma } from "@repo/db";

import { ensureInboundBindingForTelegramConnector } from "../agents/connector-binding-seed";

// One-shot backfill: for each existing TELEGRAM ConnectorInstance that has no
// INBOUND/BOTH AgentConnectorBinding, create the Controller AgentInstance (if
// missing) and an INBOUND binding pointing at it.
//
// This unblocks Task 1.1 (wiring AgentConnectorBinding to gate inbound
// routing): the runtime now resolves the inbound agent through the binding,
// so pre-existing connectors need a binding row to keep working.
//
// Idempotent — re-running is safe; rows already bound are skipped.
//
// We avoid a Prisma SQL migration because the project uses `prisma db:push`
// for schema changes (no migrations folder); data migrations live as one-shot
// tsx scripts (see migrate-telegram-link-to-connector.ts).
//
// Usage: tsx apps/api/src/scripts/backfill-controller-inbound-bindings.ts

const main = async (): Promise<void> => {
  const connectors = await prisma.connectorInstance.findMany({
    select: {
      bindings: {
        select: { direction: true, id: true },
        where: { direction: { in: ["INBOUND", "BOTH"] } },
      },
      id: true,
      orgId: true,
    },
    where: { type: "TELEGRAM" },
  });

  console.log(`Found ${connectors.length} TELEGRAM ConnectorInstance row(s).`);

  const toBackfill = connectors.filter((c) => c.bindings.length === 0);
  const alreadyBound = connectors.length - toBackfill.length;

  console.log(
    `  ${alreadyBound} already have an inbound binding — skip; ${toBackfill.length} to backfill.`,
  );

  const results = await Promise.allSettled(
    toBackfill.map((connector) =>
      ensureInboundBindingForTelegramConnector({
        connectorInstanceId: connector.id,
        orgId: connector.orgId,
        prisma,
      }).then(() => ({ connectorId: connector.id, orgId: connector.orgId })),
    ),
  );

  let created = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      console.log(
        `  org ${result.value.orgId}: created INBOUND binding for ConnectorInstance ${result.value.connectorId}`,
      );
      created += 1;
    } else {
      console.error(`  ERROR: ${String(result.reason)}`);
    }
  }

  console.log(`Done: ${created} created, ${alreadyBound} skipped.`);

  await prisma.$disconnect();
};

await main();
