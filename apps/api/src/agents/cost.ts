import type { PrismaClient } from "@repo/db";

import { logger } from "../lib/logger";

// Pricing constants. Phase 5g may move these to env vars; for now they're
// good-enough estimates. All in BRL cents (1 cent = R$0.01).
//
// Gemini 2.5 Flash via Vercel AI Gateway: ~$0.10/M input, $0.40/M output tokens (USD).
// Using USD→BRL ≈ 5.5 ⇒ R$0.55/M input, R$2.20/M output ⇒ 0.000_055 / 0.000_22 cents per token.
const COST_BRL_CENTS_PER_INPUT_TOKEN = 0.000_055;
const COST_BRL_CENTS_PER_OUTPUT_TOKEN = 0.000_22;

// gpt-image-1 standard quality: $0.04 per image (USD) ⇒ R$0.22 ⇒ 22 cents.
const COST_BRL_CENTS_PER_GENERATED_IMAGE = 22;

type CostInput = {
  externalSkillCalls: ReadonlyArray<string>; // skill IDs that incurred external cost (e.g., "generateBrandImage")
  inputTokens: number;
  outputTokens: number;
};

const computeRunCost = (input: CostInput): { costCents: number } => {
  const tokenCost = Math.ceil(
    input.inputTokens * COST_BRL_CENTS_PER_INPUT_TOKEN +
      input.outputTokens * COST_BRL_CENTS_PER_OUTPUT_TOKEN,
  );
  const externalCost = input.externalSkillCalls.reduce((sum, id) => {
    if (id === "generateBrandImage") {
      return sum + COST_BRL_CENTS_PER_GENERATED_IMAGE;
    }
    return sum;
  }, 0);
  return { costCents: tokenCost + externalCost };
};

type ThresholdResult = {
  emitted: "WARN_80" | "WARN_100" | null;
  monthToDateCents: number;
  pct: number;
};

// Checks the month-to-date cost for an AgentInstance and emits a structured
// log line when crossing 80% / 100% of budgetCents. Returns the threshold
// state for callers that want to react (future UI).
//
// v0: budget is treated as soft — never blocks execution. The log line is
// the only consumer.
const checkBudgetThresholds = async (args: {
  agentInstanceId: string;
  budgetCents: number;
  orgId: string;
  prisma: Pick<PrismaClient, "agentAction">;
}): Promise<ThresholdResult> => {
  if (args.budgetCents <= 0) {
    return { emitted: null, monthToDateCents: 0, pct: 0 };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate API requires _sum
  const agg = await args.prisma.agentAction.aggregate({
    // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate API requires _sum
    _sum: { costCents: true },
    where: {
      agentInstanceId: args.agentInstanceId,
      createdAt: { gte: monthStart },
    },
  });
  // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate API requires _sum
  const monthToDateCents = agg._sum.costCents ?? 0;
  const pct = (monthToDateCents / args.budgetCents) * 100;

  let emitted: ThresholdResult["emitted"] = null;
  if (pct >= 100) {
    emitted = "WARN_100";
    logger.warn(
      {
        agentInstanceId: args.agentInstanceId,
        budgetCents: args.budgetCents,
        monthToDateCents,
        orgId: args.orgId,
        pct: Math.round(pct),
      },
      "agentInstance.budget.exceeded",
    );
  } else if (pct >= 80) {
    emitted = "WARN_80";
    logger.warn(
      {
        agentInstanceId: args.agentInstanceId,
        budgetCents: args.budgetCents,
        monthToDateCents,
        orgId: args.orgId,
        pct: Math.round(pct),
      },
      "agentInstance.budget.threshold",
    );
  }

  return { emitted, monthToDateCents, pct };
};

export { checkBudgetThresholds, computeRunCost };
