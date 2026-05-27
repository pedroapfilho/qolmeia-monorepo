import type { ComponentType } from "react";

import type { Action } from "@/lib/api-types";

import { PublishPostCard } from "./publish-post-card";

// Per-action-type renderer registry. The approval detail page renders the
// generic "Proposta" card always (summary + JSON dump); this registry adds
// a type-specific card on top for action types we have purpose-built
// renderers for. Unknown types simply skip the extra card.
type ActionRendererProps = { proposed: Action["proposed"] };
type ActionRenderer = ComponentType<ActionRendererProps>;

const RENDERERS: Record<string, ActionRenderer> = {
  publish_post: PublishPostCard,
};

const getActionRenderer = (actionType: string): ActionRenderer | null =>
  RENDERERS[actionType] ?? null;

export { getActionRenderer };
export type { ActionRendererProps };
