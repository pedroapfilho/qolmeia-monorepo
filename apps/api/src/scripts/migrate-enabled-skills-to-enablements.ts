import "dotenv/config";

import { prisma } from "@repo/db";

// One-shot migration: for each existing AgentInstance with a non-null
// enabledSkillIds Json array, create one AgentSkillEnablement row per skill
// id. Idempotent — re-running is safe; (agentInstanceId, skillId) has a
// unique constraint so we use `skipDuplicates`.
//
// Semantics preserved:
//   - enabledSkillIds === null  → no enablement rows (runtime falls back
//     to the template defaults).
//   - enabledSkillIds === []    → no enablement rows; the empty-explicit
//     case becomes "use template defaults" until the UI lets owners opt
//     into the explicit-empty state.
//   - enabledSkillIds === [...] → one row per id.
//
// Run AFTER the schema with AgentSkillEnablement is deployed but BEFORE
// the follow-up commit that drops AgentInstance.enabledSkillIds.
//
// Usage: tsx apps/api/src/scripts/migrate-enabled-skills-to-enablements.ts

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const main = async (): Promise<void> => {
  const instances = await prisma.agentInstance.findMany({
    select: { enabledSkillIds: true, id: true },
  });

  console.log(`Found ${instances.length} AgentInstance row(s).`);

  type Plan =
    | { agentId: string; kind: "migrate"; skillIds: ReadonlyArray<string> }
    | { agentId: string; kind: "skip"; reason: string };

  const plans: Array<Plan> = instances.map((instance): Plan => {
    const ids = instance.enabledSkillIds;
    if (ids === null || ids === undefined) {
      return { agentId: instance.id, kind: "skip", reason: "enabledSkillIds=null (use defaults)" };
    }
    if (!isStringArray(ids)) {
      return {
        agentId: instance.id,
        kind: "skip",
        reason: `enabledSkillIds is not a string[] (got ${JSON.stringify(ids)})`,
      };
    }
    if (ids.length === 0) {
      return { agentId: instance.id, kind: "skip", reason: "enabledSkillIds=[] (use defaults)" };
    }
    return { agentId: instance.id, kind: "migrate", skillIds: ids };
  });

  // Log skips up-front (deterministic ordering), then run the createMany
  // calls in parallel.
  let skipped = 0;
  const toMigrate: Array<{ agentId: string; skillIds: ReadonlyArray<string> }> = [];
  for (const plan of plans) {
    if (plan.kind === "skip") {
      console.log(`  agent ${plan.agentId}: ${plan.reason} — skip`);
      skipped += 1;
    } else {
      toMigrate.push({ agentId: plan.agentId, skillIds: plan.skillIds });
    }
  }

  const results = await Promise.allSettled(
    toMigrate.map((plan) =>
      prisma.agentSkillEnablement
        .createMany({
          data: plan.skillIds.map((skillId) => ({ agentInstanceId: plan.agentId, skillId })),
          skipDuplicates: true,
        })
        .then((res) => ({ agentId: plan.agentId, count: res.count })),
    ),
  );

  let migrated = 0;
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`  ERROR: ${String(result.reason)}`);
      continue;
    }
    console.log(`  agent ${result.value.agentId}: created ${result.value.count} enablement row(s)`);
    migrated += 1;
  }

  console.log(`Done: ${migrated} migrated, ${skipped} skipped.`);

  await prisma.$disconnect();
};

await main();
