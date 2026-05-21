import type { ComponentType } from "react";

type SkillRendererProps = {
  action: {
    agentInstance: { displayName: string; templateSlug: string };
    id: string;
    proposedInput: unknown;
    proposedSummary: string;
    skillId: string;
  };
  // Future: skill-specific data (recent assets, brand context, preview output).
  // Add to this type as renderers grow.
};

type SkillRenderer = ComponentType<SkillRendererProps>;

// Registry: skill id → optional augmentation component above/beside the schema form.
// Today, no augmentations ship. The schema form alone is the default.
// To add a renderer for a skill (e.g. generateBrandImage with recent-assets gallery):
//   1. Create skill-renderers/generate-brand-image.tsx exporting a SkillRenderer component
//   2. Import + register here: SKILL_RENDERERS["generateBrandImage"] = GenerateBrandImageRenderer
// The orchestrator renders the schema form + (optionally) the augmentation above it.
const SKILL_RENDERERS: Readonly<Record<string, SkillRenderer>> = {};

const getSkillRenderer = (skillId: string): SkillRenderer | null => {
  return SKILL_RENDERERS[skillId] ?? null;
};

export { getSkillRenderer };
export type { SkillRenderer, SkillRendererProps };
