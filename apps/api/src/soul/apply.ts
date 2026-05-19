import type { PrismaClient } from "@repo/db";

import type { PartialSoul } from "../lib/ai";
import { SOUL_FIELDS, type SoulProfile } from "./soul";

type ApplyPrisma = Pick<PrismaClient, "$transaction" | "organization">;

const dedupe = (xs: ReadonlyArray<string>): Array<string> => {
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
};

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

      if (field === "contextLinks") {
        const existingLinks = existing.contextLinks ?? [];
        const merged = dedupe([...existingLinks, ...(incoming as Array<string>)]);
        const changed =
          merged.length !== existingLinks.length ||
          merged.some((v, i) => v !== existingLinks[i]);
        next.contextLinks = merged;
        if (changed) {
          captured.push("contextLinks");
        }
        continue;
      }

      const scalarIncoming = incoming as string;
      const scalarExisting = existing[field] as string | undefined;
      if (scalarIncoming !== scalarExisting) {
        if (field === "competitors") {
          next.competitors = scalarIncoming;
        } else if (field === "targetAudience") {
          next.targetAudience = scalarIncoming;
        } else if (field === "whatYouDeliver") {
          next.whatYouDeliver = scalarIncoming;
        } else if (field === "whatYouDo") {
          next.whatYouDo = scalarIncoming;
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
export type { ApplyPrisma };
