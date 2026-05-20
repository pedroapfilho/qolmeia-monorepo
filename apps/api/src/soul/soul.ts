/** The 5 soul fields. All optional — filled incrementally (free-form accumulate). */
type SoulProfile = {
  brandVoice?: string;
  differentiator?: string;
  location?: string;
  targetAudience?: string;
  whatYouDo?: string;
};

const SOUL_FIELDS: ReadonlyArray<keyof SoulProfile> = [
  "whatYouDo",
  "targetAudience",
  "differentiator",
  "brandVoice",
  "location",
];

export { SOUL_FIELDS };
export type { SoulProfile };
