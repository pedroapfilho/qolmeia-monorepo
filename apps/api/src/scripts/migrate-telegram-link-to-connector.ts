import "dotenv/config";

import { prisma } from "@repo/db";

// One-shot migration: for each existing TelegramLink row, ensure a matching
// ConnectorInstance(TELEGRAM) row exists for the same org. Idempotent —
// re-running is safe; skips orgs that already have a TELEGRAM connector.
//
// Usage: tsx apps/api/src/scripts/migrate-telegram-link-to-connector.ts

const main = async (): Promise<void> => {
  const links = await prisma.telegramLink.findMany({
    select: { orgId: true, telegramChatId: true },
  });

  console.log(`Found ${links.length} TelegramLink row(s).`);

  // Fetch all existing TELEGRAM ConnectorInstances in one query.
  const existingConnectors = await prisma.connectorInstance.findMany({
    select: { id: true, orgId: true },
    where: { type: "TELEGRAM" },
  });
  const existingOrgIds = new Set(existingConnectors.map((c) => c.orgId));

  const toCreate = links.filter((link) => !existingOrgIds.has(link.orgId));
  const skipped = links.length - toCreate.length;

  for (const existing of existingConnectors) {
    console.log(
      `  org ${existing.orgId}: ConnectorInstance already exists (${existing.id}) — skip`,
    );
  }

  const results = await Promise.allSettled(
    toCreate.map((link) =>
      prisma.connectorInstance.create({
        data: {
          capabilities: { inbound: true, outbound: true },
          config: { chatId: link.telegramChatId },
          displayName: `Telegram — ${link.telegramChatId}`,
          orgId: link.orgId,
          senderRole: "OWNER",
          type: "TELEGRAM",
        },
      }),
    ),
  );

  let created = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      console.log(`  org ${result.value.orgId}: created ConnectorInstance ${result.value.id}`);
      created += 1;
    } else {
      console.error(`  ERROR: ${String(result.reason)}`);
    }
  }

  console.log(`Done: ${created} created, ${skipped} skipped.`);

  await prisma.$disconnect();
};

await main();
