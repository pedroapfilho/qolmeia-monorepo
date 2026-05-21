import { type PrismaClient, prisma as defaultPrisma } from "@repo/db";

import { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";

import type { AssetSummary, ExistingAssetSummary } from "./dispatcher";

// JSON-serializable shape of the context blob persisted on AgentRun.contextSnapshot.
// Read by runtime.ts via the row — runtime never re-reads the soul.
type ContextSnapshot = {
  businessContext: string;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  mission: string;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
};

type BuildContextSnapshotArgs = {
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  getBusinessContext?: typeof getBusinessContextDefault;
  mission: string;
  newAssets: ReadonlyArray<AssetSummary>;
  orgId: string;
  oversizeCount: number;
  prisma?: Pick<PrismaClient, "organization">;
};

// Assembles the context blob at dispatch time. Keeps the runtime
// deterministic — once a run starts, its snapshot is frozen on the row,
// even if the soul or assets change mid-flight.
const buildContextSnapshot = async (args: BuildContextSnapshotArgs): Promise<ContextSnapshot> => {
  const getBusinessContext = args.getBusinessContext ?? getBusinessContextDefault;
  const prisma = args.prisma ?? defaultPrisma;
  const businessContext = await getBusinessContext(args.orgId, prisma);
  return {
    businessContext,
    existingAssets: args.existingAssets,
    mission: args.mission,
    newAssets: args.newAssets,
    oversizeCount: args.oversizeCount,
  };
};

export { buildContextSnapshot };
export type { BuildContextSnapshotArgs, ContextSnapshot };
