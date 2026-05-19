import { describe, expect, it, vi } from "vitest";

import { getBusinessContext } from "./knowledge-provider";

const makePrisma = (businessProfile: unknown) =>
  ({
    organization: {
      findUnique: vi.fn().mockResolvedValue(
        businessProfile === undefined ? null : { businessProfile },
      ),
    },
  }) as never;

describe("getBusinessContext", () => {
  it("returns empty string when org has no profile", async () => {
    expect(await getBusinessContext("org_1", makePrisma(undefined))).toBe("");
    expect(await getBusinessContext("org_1", makePrisma(null))).toBe("");
  });

  it("serializes a populated profile to a markdown block", async () => {
    const result = await getBusinessContext(
      "org_1",
      makePrisma({ audience: "Locals", whatYouDo: "Salon" }),
    );
    expect(result).toContain("# Business Context");
    expect(result).toContain("whatYouDo");
    expect(result).toContain("Salon");
  });
});
