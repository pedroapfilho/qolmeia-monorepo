// Single source of truth for "what system prompt does this agent run with?".
// Every site that previously read `template.systemPrompt` directly must go
// through this helper so per-instance overrides take effect.

type InstanceLike = { promptOverride: string | null };
type TemplateLike = { systemPrompt: string };

const resolveSystemPrompt = (instance: InstanceLike, template: TemplateLike): string =>
  instance.promptOverride ?? template.systemPrompt;

export { resolveSystemPrompt };
export type { InstanceLike, TemplateLike };
