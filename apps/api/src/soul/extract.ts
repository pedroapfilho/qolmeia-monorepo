import { extractSoul, type Input, type PartialSoul, type Usage } from "../lib/ai";

const extractFromMessage = (
  input: Input,
  currentContext: string,
): Promise<{ partial: PartialSoul; usage: Usage }> => extractSoul(input, currentContext);

export { extractFromMessage };
export type { Input, PartialSoul };
