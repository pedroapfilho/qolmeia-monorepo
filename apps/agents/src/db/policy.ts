type Policy = "auto-execute" | "notify-only" | "require-approval";

const POLICIES: ReadonlyArray<Policy> = ["auto-execute", "notify-only", "require-approval"];

type TemplateWithPolicies = { defaultPolicies: Record<string, string> };

const resolvePolicy = (actionType: string, template: TemplateWithPolicies): Policy => {
  const raw = template.defaultPolicies[actionType];
  const match = POLICIES.find((p) => p === raw);
  return match ?? "require-approval";
};

export { resolvePolicy };
export type { Policy };
