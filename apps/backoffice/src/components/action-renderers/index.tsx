import type { ComponentType } from "react";

import type { Action } from "@/lib/api-types";

import { PublishPostCard } from "./publish-post-card";

type ActionRendererProps = { proposed: Action["proposed"] };
type ActionRenderer = ComponentType<ActionRendererProps>;

const RENDERERS: Record<string, ActionRenderer> = {
  publish_post: PublishPostCard,
};

const getActionRenderer = (actionType: string): ActionRenderer | null =>
  RENDERERS[actionType] ?? null;

export { getActionRenderer };
