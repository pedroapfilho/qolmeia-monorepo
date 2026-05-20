import type { PrismaClient } from "@repo/db";

import { SOUL_FIELDS, type SoulProfile } from "./soul";

type PartialSoul = {
  brandVoice: string | null;
  differentiator: string | null;
  location: string | null;
  targetAudience: string | null;
  whatYouDo: string | null;
};

type ApplyPrisma = Pick<PrismaClient, "$transaction" | "organization">;

const applySoulUpdate = (
  orgId: string,
  partial: PartialSoul,
  prisma: ApplyPrisma,
): Promise<{ capturedFields: Array<keyof SoulProfile>; newProfile: SoulProfile }> => {
  return prisma.$transaction(async (tx) => {
    const row = await tx.organization.findUnique({
      select: { businessProfile: true },
      where: { id: orgId },
    });

    const existing: SoulProfile =
      row?.businessProfile !== null &&
      row?.businessProfile !== undefined &&
      typeof row.businessProfile === "object"
        ? (row.businessProfile as SoulProfile)
        : {};

    const next: SoulProfile = { ...existing };
    const captured: Array<keyof SoulProfile> = [];

    for (const field of SOUL_FIELDS) {
      const incoming = partial[field];
      if (incoming === undefined || incoming === null) {
        continue;
      }
      const scalarExisting = existing[field];
      if (incoming !== scalarExisting) {
        if (field === "whatYouDo") {
          next.whatYouDo = incoming;
        } else if (field === "targetAudience") {
          next.targetAudience = incoming;
        } else if (field === "differentiator") {
          next.differentiator = incoming;
        } else if (field === "brandVoice") {
          next.brandVoice = incoming;
        } else if (field === "location") {
          next.location = incoming;
        }
        captured.push(field);
      }
    }

    await tx.organization.update({
      data: { businessProfile: next as unknown as object },
      where: { id: orgId },
    });

    return { capturedFields: captured, newProfile: next };
  });
};

export { applySoulUpdate };
export type { ApplyPrisma, PartialSoul };
