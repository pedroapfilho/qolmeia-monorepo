import type { PrismaClient } from "@repo/db";

// Context passed to RoutineDefinition.buildPrompt. Mirrors the shape used by
// the inbound pipeline: just the bits the prompt needs, never the full
// dispatch args (those are assembled by the scheduler worker).
type RoutineBuildContext = {
  orgId: string;
  prisma: Pick<PrismaClient, "knowledgeDoc" | "organization">;
};

type RoutineConfig = Record<string, unknown>;

// Code-defined routine. Stored as JSON in the registry; mirrored to the DB by
// syncRoutines on demand. The DB row is the source of truth for runtime
// (schedule/enabled/config), but `buildPrompt` and `defaultAgentTemplate` live
// only in code so behaviour can evolve without migrations.
type RoutineDefinition = {
  buildPrompt: (config: RoutineConfig, ctx: RoutineBuildContext) => Promise<string>;
  defaultAgentTemplate: string;
  defaultConfig: RoutineConfig;
  defaultSchedule: string;
  description: string;
  name: string;
};

export type { RoutineBuildContext, RoutineConfig, RoutineDefinition };
