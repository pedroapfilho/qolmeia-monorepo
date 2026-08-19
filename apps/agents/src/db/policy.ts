import type { ActionPolicy } from "@repo/worker-api/contracts";

type TemplateWithPolicies = { defaultPolicies: Record<string, string> };

const POLICIES: ReadonlyArray<ActionPolicy> = ["auto_execute", "notify_only", "require_approval"];

/**
 * `defaultPolicies` is an operator-edited JSON blob, so its values are the one
 * place a policy string still arrives untyped. Anything unrecognised falls back
 * to the safest policy rather than the most permissive one.
 */
const resolvePolicy = (actionType: string, template: TemplateWithPolicies): ActionPolicy => {
  const raw = template.defaultPolicies[actionType];
  return POLICIES.find((policy) => policy === raw) ?? "require_approval";
};

export { resolvePolicy };
export type { ActionPolicy as Policy } from "@repo/worker-api/contracts";
