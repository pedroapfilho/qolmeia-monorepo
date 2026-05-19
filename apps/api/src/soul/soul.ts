/** The 5 soul fields. All optional — filled incrementally (free-form accumulate). */
type SoulProfile = {
  competitors?: string;
  contextLinks?: Array<string>;
  targetAudience?: string;
  whatYouDeliver?: string;
  whatYouDo?: string;
};

const SOUL_FIELDS: ReadonlyArray<keyof SoulProfile> = [
  "whatYouDo",
  "targetAudience",
  "whatYouDeliver",
  "competitors",
  "contextLinks",
];

const missingSoulFields = (profile: SoulProfile): Array<keyof SoulProfile> =>
  SOUL_FIELDS.filter((field) => {
    const value = profile[field];
    return value === undefined || (Array.isArray(value) && value.length === 0);
  });

export { missingSoulFields, SOUL_FIELDS };
export type { SoulProfile };
