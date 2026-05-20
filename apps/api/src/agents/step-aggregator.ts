// AI SDK v6 surfaces per-step content as a discriminated array — top-level
// result.toolCalls / toolResults only contain the LAST step. We walk
// step.content[] across all steps for the true count and to extract
// generated asset IDs from both direct (generateBrandImage) and delegated
// (delegateToSpecialist) tool-results.

type StepContentItem = {
  input?: unknown;
  output?: {
    [key: string]: unknown;
    assetId?: string;
    error?: string;
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

type ExtractedAction = {
  errorMessage?: string;
  input?: unknown;
  output?: unknown;
  skillId: string;
  success: boolean;
};

const extractActionsFromSteps = (
  steps: ReadonlyArray<StepShape>,
  knownSkillIds: ReadonlyArray<string>,
): ReadonlyArray<ExtractedAction> => {
  const known = new Set(knownSkillIds);
  // Build a map of tool-call by toolName to pair with tool-result. AI SDK
  // v6 emits the call first, the result next; we pair by toolName within
  // the same step (which matches v6's behavior — calls and their results
  // never cross steps).
  const actions: Array<ExtractedAction> = [];
  for (const step of steps) {
    const callsThisStep = new Map<string, { input?: unknown }>();
    for (const item of step.content ?? []) {
      if (item.type === "tool-call" && item.toolName && known.has(item.toolName)) {
        callsThisStep.set(item.toolName, { input: item.input });
        continue;
      }
      if (item.type === "tool-result" && item.toolName && known.has(item.toolName)) {
        const call = callsThisStep.get(item.toolName);
        const output = item.output;
        const success = output?.ok !== false;
        actions.push({
          errorMessage: success ? undefined : output?.error,
          input: call?.input,
          output: item.output,
          skillId: item.toolName,
          success,
        });
        callsThisStep.delete(item.toolName);
      }
    }
  }
  return actions;
};

export { aggregateSteps, extractActionsFromSteps };
export type { AggregatedSteps, ExtractedAction, StepContentItem, StepShape };
