import { describe, expect, it, vi } from "vitest";

import { applySoulUpdate } from "./apply";
import type { PartialSoul } from "../lib/ai";

const makePrisma = (existing: unknown) => {
  const updated: { businessProfile?: unknown } = { businessProfile: existing };
  const update = vi.fn().mockImplementation(({ data }: { data: { businessProfile: unknown } }) => {
    updated.businessProfile = data.businessProfile;
    return Promise.resolve(updated);
  });
  const findUnique = vi.fn().mockResolvedValue(
    existing === undefined ? null : { businessProfile: existing },
  );
  const tx = { organization: { findUnique, update } };
  return {
    _tx: tx,
    _updated: updated,
    $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    organization: tx.organization,
  } as never;
};

describe("applySoulUpdate", () => {
  it("overwrites scalar fields the model returned and preserves others", async () => {
    const prisma = makePrisma({ targetAudience: "antigo", whatYouDo: "salão" });
    const partial: PartialSoul = {
      competitors: null,
      contextLinks: null,
      targetAudience: "novo público",
      whatYouDeliver: null,
      whatYouDo: null,
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.newProfile.whatYouDo).toBe("salão");
    expect(result.newProfile.targetAudience).toBe("novo público");
    expect(result.capturedFields).toEqual(["targetAudience"]);
  });

  it("unions and dedupes contextLinks arrays in insertion order", async () => {
    const prisma = makePrisma({ contextLinks: ["https://a", "https://b"] });
    const partial: PartialSoul = {
      competitors: null,
      contextLinks: ["https://b", "https://c"],
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: null,
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.newProfile.contextLinks).toEqual(["https://a", "https://b", "https://c"]);
    expect(result.capturedFields).toEqual(["contextLinks"]);
  });

  it("captures nothing when partial only contains nulls", async () => {
    const prisma = makePrisma({ whatYouDo: "salão" });
    const partial: PartialSoul = {
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: null,
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.capturedFields).toEqual([]);
    expect(result.newProfile.whatYouDo).toBe("salão");
  });

  it("starts from empty when org has no businessProfile yet", async () => {
    const prisma = makePrisma(null);
    const partial: PartialSoul = {
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: "salão",
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.newProfile).toEqual({ whatYouDo: "salão" });
    expect(result.capturedFields).toEqual(["whatYouDo"]);
  });
});
