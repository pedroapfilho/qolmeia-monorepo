import { extractSoul, runAgent as runAgentImpl, type Input, type PartialSoul, type Usage } from "../lib/ai";

const extractFromMessage = (
  input: Input,
  currentContext: string,
): Promise<{ partial: PartialSoul; reply: string; usage: Usage }> => extractSoul(input, currentContext);

const runAgent = runAgentImpl;

export { extractFromMessage, runAgent };
export type { AgentInput, AgentResult, AssetSummary, ExistingAssetSummary } from "../lib/ai";
export type { Input, PartialSoul };
