import type { ConnectorType, PrismaClient } from "@repo/db";
import type { z } from "zod";

import type { AgentDispatchArgs, AgentDispatcher } from "../dispatcher";

type SkillContext = {
  agentInstanceId: string;
  dispatcher: AgentDispatcher;
  orgId: string;
  parentRunArgs: AgentDispatchArgs;
  // The AgentRun id this skill is running inside. Skills that spawn child
  // runs (delegateToSpecialist) thread it through as AgentRun.parentRunId.
  parentRunId: string;
  prisma: PrismaClient;
};

type Skill<TInput, TOutput> = {
  description: string;
  displayName: string;
  execute: (args: TInput, ctx: SkillContext) => Promise<TOutput>;
  id: string;
  inputSchema: z.ZodSchema<TInput>;
  requiredConnectorTypes: ReadonlyArray<ConnectorType>;
  requiresApprovalDefault: boolean;
};

// Heterogeneous-array escape hatch. The registry holds skills of varying
// TInput/TOutput; AnySkill is the widened super-type. Skills declared via
// defineSkill keep their precise types at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySkill = Skill<any, any>;

const defineSkill = <TInput, TOutput>(config: Skill<TInput, TOutput>): Skill<TInput, TOutput> =>
  config;

export { defineSkill };
export type { AnySkill, Skill, SkillContext };
