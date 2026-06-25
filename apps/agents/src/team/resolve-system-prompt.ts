type InstanceLike = { promptOverride: string | null };
type TemplateLike = { systemPrompt: string };

const resolveSystemPrompt = (instance: InstanceLike, template: TemplateLike): string =>
  instance.promptOverride ?? template.systemPrompt;

export { resolveSystemPrompt };
export type { InstanceLike, TemplateLike };
