import type { ConnectorType, PrismaClient } from "@repo/db";
import type { z } from "zod";

type SkillContext = {
  orgId: string;
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

export type { Skill, SkillContext };
