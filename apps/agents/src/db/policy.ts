// Action policy resolution. Each Worker template carries a default_policies
// JSON map of actionType → policy; resolvePolicy reads it and falls back to
// the safest option (require-approval) for any action type the template
// doesn't pin. Company-level overrides land in a future phase (the schema
// would need a company_policy table).

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
