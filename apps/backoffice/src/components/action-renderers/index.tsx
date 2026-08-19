import type { Action } from "@repo/worker-api/contracts";
import type { ComponentType } from "react";

import { PublishPostCard } from "./publish-post-card";

type ActionRendererProps = { proposed: Action["proposed"] };
type ActionRenderer = ComponentType<ActionRendererProps>;

type RenderersContract = Record<string, ActionRenderer>;

const RENDERERS = {
  publish_post: PublishPostCard,
} satisfies RenderersContract;

const rendererByActionType = new Map<string, ActionRenderer>(Object.entries(RENDERERS));

const getActionRenderer = (actionType: string): ActionRenderer | null =>
  rendererByActionType.get(actionType) ?? null;

export { getActionRenderer };
