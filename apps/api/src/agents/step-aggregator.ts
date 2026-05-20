// AI SDK v6 surfaces per-step content as a discriminated array — top-level
// result.toolCalls / toolResults only contain the LAST step. We walk
// step.content[] across all steps for the true count and to extract
// generated asset IDs from both direct (generateBrandImage) and delegated
// (delegateToSpecialist) tool-results.

type StepContentItem = {
  output?: {
    assetId?: string;
    generatedAssetIds?: ReadonlyArray<string>;
    ok?: boolean;
  };
  toolName?: string;
  type: string;
};

type StepShape = { content?: ReadonlyArray<StepContentItem> };

type AggregatedSteps = {
  generatedAssetIds: ReadonlyArray<string>;
  toolCallSummary: Record<string, number>;
};

const aggregateSteps = (
  steps: ReadonlyArray<StepShape>,
  knownSkillIds: ReadonlyArray<string>,
): AggregatedSteps => {
  const summary: Record<string, number> = Object.fromEntries(knownSkillIds.map((id) => [id, 0]));
  const generatedAssetIds: Array<string> = [];

  for (const step of steps) {
    for (const item of step.content ?? []) {
      if (item.type === "tool-call" && item.toolName && item.toolName in summary) {
        summary[item.toolName] = (summary[item.toolName] ?? 0) + 1;
        continue;
      }
      if (item.type === "tool-result" && item.output?.ok === true) {
        if (item.toolName === "generateBrandImage" && item.output.assetId) {
          generatedAssetIds.push(item.output.assetId);
        } else if (
          item.toolName === "delegateToSpecialist" &&
          Array.isArray(item.output.generatedAssetIds)
        ) {
          generatedAssetIds.push(...item.output.generatedAssetIds);
        }
      }
    }
  }

  return { generatedAssetIds, toolCallSummary: summary };
};

export { aggregateSteps };
export type { AggregatedSteps, StepContentItem, StepShape };
