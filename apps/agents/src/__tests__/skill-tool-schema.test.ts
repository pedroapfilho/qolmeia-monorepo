import { env } from "cloudflare:test";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildFlueTools, buildInputSchema } from "#/lib/skill-tool";
import type { SkillContext } from "#/skills/registry";
import { listSkillCatalog } from "#/skills/registry";

const ctx: SkillContext = {
  agentInstanceId: "agent_schema_test",
  companyId: "co_schema_test",
  get env() {
    return env;
  },
};

describe("buildFlueTools — zod input schemas re-expressed as Valibot", () => {
  it("converts every registered skill's input schema without throwing", async () => {
    const ids = listSkillCatalog().map((entry) => entry.id);
    const tools = await buildFlueTools(ctx, ids);
    expect(tools.map((tool) => tool.name).toSorted()).toEqual(ids.toSorted());
    for (const tool of tools) {
      expect(tool.input).toBeDefined();
    }
  });

  it("keeps required fields and length limits enforceable", async () => {
    const [delegate] = await buildFlueTools(ctx, ["delegateToWorker"]);
    const input = delegate?.input;
    if (!input) {
      throw new Error("delegateToWorker input schema missing");
    }
    expect(
      v.safeParse(input, { brief: "postar no instagram", workerKind: "designer" }).success,
    ).toBe(true);
    expect(v.safeParse(input, { workerKind: "designer" }).success).toBe(false);
    expect(v.safeParse(input, { brief: "", workerKind: "designer" }).success).toBe(false);
  });

  it("keeps enums and optional fields enforceable", async () => {
    const [listAssets] = await buildFlueTools(ctx, ["listAssets"]);
    const input = listAssets?.input;
    if (!input) {
      throw new Error("listAssets input schema missing");
    }
    expect(v.safeParse(input, {}).success).toBe(true);
    expect(v.safeParse(input, { folder: "customer" }).success).toBe(true);
    expect(v.safeParse(input, { folder: "not-a-folder" }).success).toBe(false);
  });

  it("rejects unsupported schema shapes at conversion time", () => {
    const unionField = z.union([z.string(), z.number()]);
    const unionSchema = z.object({ value: unionField });
    expect(() => buildInputSchema(unionSchema, "union-skill")).toThrow(/unsupported/iv);

    const nullableField = z.string().nullable();
    const nullableSchema = z.object({ value: nullableField });
    expect(() => buildInputSchema(nullableSchema, "nullable-skill")).toThrow(/unsupported/iv);
  });
});
