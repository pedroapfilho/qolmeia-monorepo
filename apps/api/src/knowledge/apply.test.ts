import { describe, expect, it, vi } from "vitest";

import { applySoulUpdate, type PartialSoul } from "./apply";

const makePrisma = (existing: unknown) => {
  const updated: { businessProfile?: unknown } = { businessProfile: existing };
  const update = vi.fn().mockImplementation(({ data }: { data: { businessProfile: unknown } }) => {
    updated.businessProfile = data.businessProfile;
    return Promise.resolve(updated);
  });
  const findUnique = vi
    .fn()
    .mockResolvedValue(existing === undefined ? null : { businessProfile: existing });
  const tx = { organization: { findUnique, update } };
  return {
    _tx: tx,
    _updated: updated,
    $transaction: vi.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    organization: tx.organization,
  } as never;
};

const emptyPartial: PartialSoul = {
  brandVoice: null,
  differentiator: null,
  location: null,
  targetAudience: null,
  whatYouDo: null,
};

describe("applySoulUpdate", () => {
  it("overwrites scalar fields the model returned and preserves others", async () => {
    const prisma = makePrisma({ targetAudience: "antigo", whatYouDo: "salão" });
    const partial: PartialSoul = {
      ...emptyPartial,
      targetAudience: "novo público",
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.newProfile.whatYouDo).toBe("salão");
    expect(result.newProfile.targetAudience).toBe("novo público");
    expect(result.capturedFields).toEqual(["targetAudience"]);
  });

  it("overwrites the new differentiator, brandVoice, and location fields", async () => {
    const prisma = makePrisma({});
    const partial: PartialSoul = {
      ...emptyPartial,
      brandVoice: "descontraído e jovem",
      differentiator: "atendimento personalizado",
      location: "São Paulo",
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.newProfile.differentiator).toBe("atendimento personalizado");
    expect(result.newProfile.brandVoice).toBe("descontraído e jovem");
    expect(result.newProfile.location).toBe("São Paulo");
    expect(result.capturedFields).toEqual(["differentiator", "brandVoice", "location"]);
  });

  it("captures nothing when partial only contains nulls", async () => {
    const prisma = makePrisma({ whatYouDo: "salão" });
    const result = await applySoulUpdate("org_1", emptyPartial, prisma);

    expect(result.capturedFields).toEqual([]);
    expect(result.newProfile.whatYouDo).toBe("salão");
  });

  it("starts from empty when org has no businessProfile yet", async () => {
    const prisma = makePrisma(null);
    const partial: PartialSoul = {
      ...emptyPartial,
      whatYouDo: "salão",
    };
    const result = await applySoulUpdate("org_1", partial, prisma);

    expect(result.newProfile).toEqual({ whatYouDo: "salão" });
    expect(result.capturedFields).toEqual(["whatYouDo"]);
  });
});
