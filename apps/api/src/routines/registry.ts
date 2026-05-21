import type { PrismaClient } from "@repo/db";

import { nightlyKnowledgeSummary } from "./nightly-knowledge-summary";
import type { RoutineDefinition } from "./types";

const ALL_ROUTINES: ReadonlyArray<RoutineDefinition> = [nightlyKnowledgeSummary];

const findRoutineByName = (name: string): RoutineDefinition | undefined =>
  ALL_ROUTINES.find((r) => r.name === name);

type SyncRoutinesPrisma = Pick<PrismaClient, "agentInstance" | "routine">;

// Upserts a Routine row for each definition × org. NEVER touches the
// `enabled` flag on existing rows — Paperclip pattern: routines start paused
// and only the owner flips them on. New rows get `enabled = false` + the
// definition's defaultConfig/defaultSchedule; existing rows keep whatever the
// owner customised (config + schedule + enabled).
//
// `targetOrgIds` scopes the sync. Pass [] to skip work; pass a specific list
// to seed only those orgs. The scripts/sync-routines.ts wrapper resolves
// "all orgs" when invoked from the CLI.
const syncRoutines = async ({
  prisma,
  targetOrgIds,
}: {
  prisma: SyncRoutinesPrisma;
  targetOrgIds: ReadonlyArray<string>;
}): Promise<{ created: number; orgsTouched: number; skipped: number }> => {
  if (targetOrgIds.length === 0) {
    return { created: 0, orgsTouched: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;

  for (const orgId of targetOrgIds) {
    for (const definition of ALL_ROUTINES) {
      // The routine binds to an AgentInstance, so the target template MUST
      // already exist for the org. Skip silently when it doesn't — the
      // ensureAgentInstance path is owned by the inbox pipeline, not this
      // helper.
      // eslint-disable-next-line no-await-in-loop
      const agentInstance = await prisma.agentInstance.findUnique({
        select: { id: true },
        where: {
          orgId_templateSlug: { orgId, templateSlug: definition.defaultAgentTemplate },
        },
      });
      if (!agentInstance) {
        skipped += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const existing = await prisma.routine.findUnique({
        select: { id: true },
        where: { orgId_name: { name: definition.name, orgId } },
      });
      if (existing) {
        // Pedro's per-org customisations (schedule, config, enabled) win over
        // registry defaults. Refresh description only — it's the human-facing
        // label and tracks the registry verbatim.
        // eslint-disable-next-line no-await-in-loop
        await prisma.routine.update({
          data: { description: definition.description },
          where: { id: existing.id },
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await prisma.routine.create({
        data: {
          agentInstanceId: agentInstance.id,
          config: definition.defaultConfig,
          description: definition.description,
          enabled: false,
          name: definition.name,
          orgId,
          schedule: definition.defaultSchedule,
        },
      });
      created += 1;
    }
  }

  return { created, orgsTouched: targetOrgIds.length, skipped };
};

export { ALL_ROUTINES, findRoutineByName, syncRoutines };
export type { SyncRoutinesPrisma };
