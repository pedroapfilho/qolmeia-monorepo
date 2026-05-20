# Phase 5b — Skills Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three inline tool definitions (`extractSoul`, `labelBrandAsset`, `generateBrandImage`) out of `apps/api/src/lib/ai.ts` into one-skill-per-file modules under `apps/api/src/agents/skills/`, expose them through a registry, and rename the `apps/api/src/soul/` folder to `apps/api/src/knowledge/`. No behavior change — the bot must reply identically after this phase.

**Architecture:** Each Skill is `{ id, displayName, description, inputSchema (Zod), requiresApprovalDefault, requiredConnectorTypes, execute(args, ctx) }` per spec §6. The registry exports `ALL_SKILLS: ReadonlyArray<Skill>`. `runAgent` in `lib/ai.ts` maps `ALL_SKILLS` to the AI SDK's `tool()` shape at request time, passing a `SkillContext` `{ orgId, prisma }` closure to each skill's `execute`. The current soul/ folder becomes knowledge/ with `knowledge-provider.ts` shortening to `provider.ts`. No Prisma reads/writes of the Phase 5a tables yet — those wait for Phase 5c.

**Tech Stack:** Vercel AI SDK v6 (`generateText`, `tool`, `gateway`, `stepCountIs`), Zod 4 (input schemas), Vitest 4 (per-skill unit tests + the existing integration tests).

**Builds on:** `main` HEAD `ef7504a` (after Phase 5a).

---

## File map

| File                                                      | Action                                              | Responsibility                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/api/src/agents/skills/types.ts`                     | Create                                              | Defines `Skill<TInput, TOutput>` + `SkillContext` types                                                  |
| `apps/api/src/agents/skills/registry.ts`                  | Create                                              | Exports `ALL_SKILLS: ReadonlyArray<Skill>`                                                               |
| `apps/api/src/agents/skills/extract-soul.ts`              | Create                                              | The `extractSoul` skill — closure-over-orgId/prisma replaced by ctx                                      |
| `apps/api/src/agents/skills/extract-soul.test.ts`         | Create                                              | Unit test for the skill                                                                                  |
| `apps/api/src/agents/skills/label-brand-asset.ts`         | Create                                              | The `labelBrandAsset` skill                                                                              |
| `apps/api/src/agents/skills/label-brand-asset.test.ts`    | Create                                              | Unit test                                                                                                |
| `apps/api/src/agents/skills/generate-brand-image.ts`      | Create                                              | The `generateBrandImage` skill (brand-context aggregation + image-gen + ingestGeneratedAsset)            |
| `apps/api/src/agents/skills/generate-brand-image.test.ts` | Create                                              | Unit test                                                                                                |
| `apps/api/src/lib/ai.ts`                                  | Modify                                              | Replace the `tools` literal with a registry-driven map. Existing prompt template + step aggregation stay |
| `apps/api/src/lib/ai.test.ts`                             | Modify                                              | Adjust test mocks if needed for the new wiring (assertion shape stays)                                   |
| `apps/api/src/soul/` (whole folder)                       | Rename to `apps/api/src/knowledge/`                 | git-mv preserves history                                                                                 |
| `apps/api/src/soul/knowledge-provider.ts`                 | Rename to `apps/api/src/knowledge/provider.ts`      | Same content; shorter name in the renamed folder                                                         |
| `apps/api/src/soul/knowledge-provider.test.ts`            | Rename to `apps/api/src/knowledge/provider.test.ts` | Test follows source rename                                                                               |
| `apps/api/src/telegram/handler.ts`                        | Modify                                              | Update `../soul/...` imports → `../knowledge/...`                                                        |
| All files inside the renamed knowledge/ folder            | Modify                                              | Update relative imports (`./knowledge-provider` → `./provider`)                                          |

**Files NOT touched in 5b:**

- `apps/api/src/soul/extract.ts` (will be renamed to `knowledge/extract.ts` as part of the folder rename, but its 2-line re-export body stays the same).
- All Phase 5a code (schema, generated client, new db tests).
- Connector code (Phase 5c+).
- New `agents/templates/` or `agents/runtime.ts` (Phase 5c).

---

## Task 1: Setup — branch, baseline, stash unrelated dirty file

**Files:** none modified

- [ ] **Step 1: Confirm current branch and HEAD**

```bash
git status --porcelain && git log --oneline -1
```

Expected: HEAD is `ef7504a test(db): Phase 5a schema CRUD smoke tests`. If `git status --porcelain` shows `apps/api/src/routes/telegram/webhook.ts` as `M`, that's the unrelated comment-removal change Pedro is carrying — stash it.

- [ ] **Step 2: Stash the unrelated dirty file**

```bash
git stash push -m "phase-5b-precheck-webhook-comment" apps/api/src/routes/telegram/webhook.ts
git status --porcelain
```

Expected: clean working tree (no `M` lines). The stash will be restored at the end of Task 8.

- [ ] **Step 3: Confirm docker + local Postgres are up**

```bash
docker compose ps --format "table {{.Service}}\t{{.Status}}"
```

Expected: both `postgres` and `redis` rows show `Up (healthy)`. Run `docker compose up -d` if not.

- [ ] **Step 4: Confirm baseline gates green**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Each exits 0. Tests: 60 passing (56 api + 4 db).

- [ ] **Step 5: Confirm the dev server is running and bot is healthy**

```bash
curl -s http://localhost:4000/healthz && echo
```

If the API isn't running, start it in a separate terminal with `pnpm dev --filter=api`. Keep that terminal alive — Task 8 needs the bot live for the smoke test.

- [ ] **Step 6: Branch off main**

```bash
git checkout main
git checkout -b qolmeia-phase-5b-skills-extraction
git branch --show-current
```

Expected: branch name printed is `qolmeia-phase-5b-skills-extraction`.

---

## Task 2: Add Skill types + empty registry

**Files:**

- Create: `apps/api/src/agents/skills/types.ts`
- Create: `apps/api/src/agents/skills/registry.ts`

- [ ] **Step 1: Create `apps/api/src/agents/skills/types.ts`**

```ts
import type { ConnectorType, PrismaClient } from "@repo/db";
import type { z } from "zod";

type SkillContext = {
  orgId: string;
  prisma: PrismaClient;
};

type Skill<TInput, TOutput> = {
  description: string;
  displayName: string;
  execute: (args: TInput, ctx: SkillContext) => Promise<TOutput>;
  id: string;
  inputSchema: z.ZodSchema<TInput>;
  requiredConnectorTypes: ReadonlyArray<ConnectorType>;
  requiresApprovalDefault: boolean;
};

export type { Skill, SkillContext };
```

- [ ] **Step 2: Create `apps/api/src/agents/skills/registry.ts` with an empty registry**

```ts
import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [];

export { ALL_SKILLS };
```

- [ ] **Step 3: Format + typecheck**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/types.ts apps/api/src/agents/skills/registry.ts
pnpm typecheck
```

Both exit 0. The empty registry should not break anything because no code imports it yet.

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Exit 0. (oxlint may flag `Skill<unknown, unknown>` for the empty array — that's fine; the next task will populate it with real types.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/skills/types.ts apps/api/src/agents/skills/registry.ts
git commit -m "feat(api): add Skill types and empty skills registry"
```

---

## Task 3: Extract `extractSoul` skill

**Files:**

- Create: `apps/api/src/agents/skills/extract-soul.ts`
- Create: `apps/api/src/agents/skills/extract-soul.test.ts`
- Modify: `apps/api/src/agents/skills/registry.ts` (add the import + register)

`extractSoul` calls `applySoulUpdate(orgId, partial, prisma)` and returns `{ capturedFields }`. The current `extractSoulToolInput` Zod schema in `apps/api/src/lib/ai.ts:41-47` moves verbatim.

- [ ] **Step 1: Write the unit test first (TDD)**

Create `apps/api/src/agents/skills/extract-soul.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { extractSoulSkill } from "./extract-soul";

vi.mock("../../soul/apply", () => ({
  applySoulUpdate: vi.fn(),
}));

describe("extractSoulSkill", () => {
  it("has the expected metadata for the registry", () => {
    expect(extractSoulSkill.id).toBe("extractSoul");
    expect(extractSoulSkill.displayName).toBe("Extract Soul");
    expect(extractSoulSkill.requiresApprovalDefault).toBe(false);
    expect(extractSoulSkill.requiredConnectorTypes).toEqual([]);
  });

  it("parses input via inputSchema (Zod) — accepts the 5 nullable soul fields", () => {
    const parsed = extractSoulSkill.inputSchema.parse({
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: "donos de salão de barbearia",
      whatYouDo: "salão de cabelo e barba",
    });
    expect(parsed.whatYouDo).toBe("salão de cabelo e barba");
    expect(parsed.brandVoice).toBeNull();
  });

  it("execute() forwards to applySoulUpdate(orgId, partial, prisma) and returns capturedFields", async () => {
    const { applySoulUpdate } = await import("../../soul/apply");
    vi.mocked(applySoulUpdate).mockResolvedValueOnce({
      capturedFields: ["whatYouDo"],
      newProfile: { whatYouDo: "salão" },
    });
    const fakePrisma = { id: "fake-prisma" } as never;

    const result = await extractSoulSkill.execute(
      {
        brandVoice: null,
        differentiator: null,
        location: null,
        targetAudience: null,
        whatYouDo: "salão",
      },
      { orgId: "org_1", prisma: fakePrisma },
    );

    expect(applySoulUpdate).toHaveBeenCalledOnce();
    expect(applySoulUpdate).toHaveBeenCalledWith(
      "org_1",
      {
        brandVoice: null,
        differentiator: null,
        location: null,
        targetAudience: null,
        whatYouDo: "salão",
      },
      fakePrisma,
    );
    expect(result).toEqual({ capturedFields: ["whatYouDo"] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter api test extract-soul
```

Expected: FAIL — `Cannot find module './extract-soul'` or similar (file doesn't exist yet).

- [ ] **Step 3: Create `apps/api/src/agents/skills/extract-soul.ts`**

```ts
import { z } from "zod";

import { applySoulUpdate } from "../../soul/apply";

import type { Skill } from "./types";

const extractSoulInput = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

type ExtractSoulInput = z.infer<typeof extractSoulInput>;

type ExtractSoulOutput = {
  capturedFields: ReadonlyArray<keyof ExtractSoulInput>;
};

const extractSoulSkill: Skill<ExtractSoulInput, ExtractSoulOutput> = {
  description:
    "Atualize os 5 campos do perfil do dono. Use SOMENTE quando a mensagem trouxer info ou correção. Campos não mencionados ficam null.",
  displayName: "Extract Soul",
  execute: async (args, ctx) => {
    const out = await applySoulUpdate(ctx.orgId, args, ctx.prisma);
    return { capturedFields: out.capturedFields };
  },
  id: "extractSoul",
  inputSchema: extractSoulInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
};

export { extractSoulSkill };
export type { ExtractSoulInput, ExtractSoulOutput };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter api test extract-soul
```

Expected: 3 tests pass.

- [ ] **Step 5: Register the skill**

Edit `apps/api/src/agents/skills/registry.ts`:

```ts
import { extractSoulSkill } from "./extract-soul";

import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  extractSoulSkill as Skill<unknown, unknown>,
];

export { ALL_SKILLS };
```

The `as Skill<unknown, unknown>` cast is unfortunate but necessary because TypeScript can't infer a heterogeneous array of skill types. Phase 5c may introduce a discriminated-union helper if this becomes a pain point.

- [ ] **Step 6: Format + typecheck + lint**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/extract-soul.ts apps/api/src/agents/skills/extract-soul.test.ts apps/api/src/agents/skills/registry.ts
pnpm typecheck
pnpm lint
```

All exit 0.

- [ ] **Step 7: Confirm the full repo test suite still passes**

```bash
pnpm test
```

Expected: 60 tests + the 3 new extract-soul tests = 63 passing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/agents/skills/extract-soul.ts apps/api/src/agents/skills/extract-soul.test.ts apps/api/src/agents/skills/registry.ts
git commit -m "feat(api): extract extractSoul skill into agents/skills/"
```

---

## Task 4: Extract `labelBrandAsset` skill

**Files:**

- Create: `apps/api/src/agents/skills/label-brand-asset.ts`
- Create: `apps/api/src/agents/skills/label-brand-asset.test.ts`
- Modify: `apps/api/src/agents/skills/registry.ts`

`labelBrandAsset` calls `prisma.brandAsset.update` with the palette/style/typography metadata. The current `labelBrandAssetToolInput` Zod schema in `apps/api/src/lib/ai.ts:54-59` moves verbatim.

- [ ] **Step 1: Write the unit test first**

Create `apps/api/src/agents/skills/label-brand-asset.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { labelBrandAssetSkill } from "./label-brand-asset";

describe("labelBrandAssetSkill", () => {
  it("has the expected metadata for the registry", () => {
    expect(labelBrandAssetSkill.id).toBe("labelBrandAsset");
    expect(labelBrandAssetSkill.displayName).toBe("Label Brand Asset");
    expect(labelBrandAssetSkill.requiresApprovalDefault).toBe(false);
    expect(labelBrandAssetSkill.requiredConnectorTypes).toEqual([]);
  });

  it("validates hex palette + style + typography via Zod", () => {
    const ok = labelBrandAssetSkill.inputSchema.parse({
      assetId: "asset_1",
      palette: ["#FFEEDD", "#112233"],
      styleDescriptors: ["minimalista", "moderno"],
      typography: "sans",
    });
    expect(ok.palette).toHaveLength(2);

    expect(() =>
      labelBrandAssetSkill.inputSchema.parse({
        assetId: "asset_1",
        palette: ["not-a-hex"],
        styleDescriptors: ["x"],
        typography: "sans",
      }),
    ).toThrow();
  });

  it("execute() updates brandAsset.metadata with palette/style/typography", async () => {
    const update = vi.fn().mockResolvedValue({});
    const fakePrisma = { brandAsset: { update } } as never;

    const result = await labelBrandAssetSkill.execute(
      {
        assetId: "asset_1",
        palette: ["#112233", "#445566"],
        styleDescriptors: ["minimalista"],
        typography: "sans",
      },
      { orgId: "org_1", prisma: fakePrisma },
    );

    expect(update).toHaveBeenCalledWith({
      data: {
        metadata: {
          palette: ["#112233", "#445566"],
          styleDescriptors: ["minimalista"],
          typography: "sans",
        },
      },
      where: { id: "asset_1" },
    });
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Verify the test fails**

```bash
pnpm --filter api test label-brand-asset
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/agents/skills/label-brand-asset.ts`**

```ts
import { z } from "zod";

import type { Skill } from "./types";

const labelBrandAssetInput = z.object({
  assetId: z.string().min(1),
  palette: z
    .array(z.string().regex(/^#[0-9A-Fa-f]{6}$/iv))
    .min(1)
    .max(8),
  styleDescriptors: z.array(z.string().min(1)).min(1).max(6),
  typography: z.enum(["serif", "sans", "script", "handwritten", "decorative", "unknown"]),
});

type LabelBrandAssetInput = z.infer<typeof labelBrandAssetInput>;

type LabelBrandAssetOutput = { ok: true };

const labelBrandAssetSkill: Skill<LabelBrandAssetInput, LabelBrandAssetOutput> = {
  description:
    "Anote metadados visuais de UM asset que o dono enviou. Use um assetId de 'Novos assets'. Chame uma vez por assetId.",
  displayName: "Label Brand Asset",
  execute: async (args, ctx) => {
    await ctx.prisma.brandAsset.update({
      data: {
        metadata: {
          palette: args.palette,
          styleDescriptors: args.styleDescriptors,
          typography: args.typography,
        },
      },
      where: { id: args.assetId },
    });
    return { ok: true };
  },
  id: "labelBrandAsset",
  inputSchema: labelBrandAssetInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
};

export { labelBrandAssetSkill };
export type { LabelBrandAssetInput, LabelBrandAssetOutput };
```

- [ ] **Step 4: Verify the test passes**

```bash
pnpm --filter api test label-brand-asset
```

Expected: 3 tests pass.

- [ ] **Step 5: Register the skill**

Edit `apps/api/src/agents/skills/registry.ts`:

```ts
import { extractSoulSkill } from "./extract-soul";
import { labelBrandAssetSkill } from "./label-brand-asset";

import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  extractSoulSkill as Skill<unknown, unknown>,
  labelBrandAssetSkill as Skill<unknown, unknown>,
];

export { ALL_SKILLS };
```

- [ ] **Step 6: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/label-brand-asset.ts apps/api/src/agents/skills/label-brand-asset.test.ts apps/api/src/agents/skills/registry.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 66 (60 + 3 extract-soul + 3 label-brand-asset).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents/skills/label-brand-asset.ts apps/api/src/agents/skills/label-brand-asset.test.ts apps/api/src/agents/skills/registry.ts
git commit -m "feat(api): extract labelBrandAsset skill into agents/skills/"
```

---

## Task 5: Extract `generateBrandImage` skill

**Files:**

- Create: `apps/api/src/agents/skills/generate-brand-image.ts`
- Create: `apps/api/src/agents/skills/generate-brand-image.test.ts`
- Modify: `apps/api/src/agents/skills/registry.ts`

`generateBrandImage` is the most complex skill: it queries recent BrandAssets for brand context, builds the enriched prompt, calls `generateBrandImageBytes`, and calls `ingestGeneratedAsset`. The full logic lives at `apps/api/src/lib/ai.ts:162-228` today.

- [ ] **Step 1: Write the unit test first**

Create `apps/api/src/agents/skills/generate-brand-image.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { generateBrandImageSkill } from "./generate-brand-image";

vi.mock("../../lib/image-gen", () => ({
  generateBrandImageBytes: vi.fn(),
}));
vi.mock("../../soul/brand-asset", () => ({
  ingestGeneratedAsset: vi.fn(),
}));

describe("generateBrandImageSkill", () => {
  it("has the expected metadata", () => {
    expect(generateBrandImageSkill.id).toBe("generateBrandImage");
    expect(generateBrandImageSkill.displayName).toBe("Generate Brand Image");
    expect(generateBrandImageSkill.requiresApprovalDefault).toBe(false);
    expect(generateBrandImageSkill.requiredConnectorTypes).toEqual([]);
  });

  it("validates input via Zod (aspectRatio enum + prompt length)", () => {
    const parsed = generateBrandImageSkill.inputSchema.parse({
      aspectRatio: "16:9",
      prompt: "Banner de Black Friday",
    });
    expect(parsed.aspectRatio).toBe("16:9");

    // default aspectRatio
    const defaulted = generateBrandImageSkill.inputSchema.parse({ prompt: "x" });
    expect(defaulted.aspectRatio).toBe("1:1");

    // prompt too long
    expect(() => generateBrandImageSkill.inputSchema.parse({ prompt: "x".repeat(2001) })).toThrow();
  });

  it("execute() composes brand context, calls image-gen, ingests result", async () => {
    const { generateBrandImageBytes } = await import("../../lib/image-gen");
    const { ingestGeneratedAsset } = await import("../../soul/brand-asset");

    vi.mocked(generateBrandImageBytes).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    vi.mocked(ingestGeneratedAsset).mockResolvedValueOnce({ assetId: "gen_1" });

    const findMany = vi.fn().mockResolvedValue([
      {
        metadata: {
          palette: ["#FF0000"],
          styleDescriptors: ["moderno"],
          typography: "sans",
        },
      },
      { metadata: { source: "generated" } }, // should be skipped
    ]);
    const fakePrisma = { brandAsset: { findMany } } as never;

    const result = await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "Banner de promo" },
      { orgId: "org_1", prisma: fakePrisma },
    );

    expect(findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
      take: 3,
      where: { orgId: "org_1" },
    });
    expect(generateBrandImageBytes).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(generateBrandImageBytes).mock.calls[0]![0];
    expect(callArgs.aspectRatio).toBe("1:1");
    expect(callArgs.prompt).toContain("Banner de promo");
    expect(callArgs.prompt).toContain("Aspect ratio: 1:1.");
    expect(callArgs.prompt).toContain("#FF0000");
    expect(callArgs.prompt).toContain("moderno");
    expect(callArgs.prompt).toContain("sans");
    expect(ingestGeneratedAsset).toHaveBeenCalledOnce();
    expect(result).toEqual({ assetId: "gen_1", ok: true });
  });

  it("execute() returns { ok: false, error } when image generation fails", async () => {
    const { generateBrandImageBytes } = await import("../../lib/image-gen");

    vi.mocked(generateBrandImageBytes).mockRejectedValueOnce(new Error("gateway 500"));

    const findMany = vi.fn().mockResolvedValue([]);
    const fakePrisma = { brandAsset: { findMany } } as never;

    const result = await generateBrandImageSkill.execute(
      { aspectRatio: "1:1", prompt: "x" },
      { orgId: "org_1", prisma: fakePrisma },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("gateway 500");
  });
});
```

- [ ] **Step 2: Verify the test fails**

```bash
pnpm --filter api test generate-brand-image
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/agents/skills/generate-brand-image.ts`**

```ts
import { z } from "zod";

import { generateBrandImageBytes } from "../../lib/image-gen";
import { logger } from "../../lib/logger";
import { ingestGeneratedAsset } from "../../soul/brand-asset";

import type { Skill } from "./types";

const generateBrandImageInput = z.object({
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
  prompt: z.string().min(1).max(2000),
});

type GenerateBrandImageInput = z.infer<typeof generateBrandImageInput>;

type GenerateBrandImageOutput = { assetId: string; ok: true } | { error: string; ok: false };

type BrandAssetMetadata = {
  palette?: ReadonlyArray<string>;
  source?: string;
  styleDescriptors?: ReadonlyArray<string>;
  typography?: string;
} | null;

const generateBrandImageSkill: Skill<GenerateBrandImageInput, GenerateBrandImageOutput> = {
  description:
    "Gere uma imagem para o dono baseada no perfil do negócio (soul + brand assets). Use APENAS quando o dono pedir explicitamente. AT MOST 1 call por mensagem.",
  displayName: "Generate Brand Image",
  execute: async ({ aspectRatio, prompt }, ctx) => {
    try {
      const refRows = await ctx.prisma.brandAsset.findMany({
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
        take: 3,
        where: { orgId: ctx.orgId },
      });

      const palette = new Set<string>();
      const styles = new Set<string>();
      let typography: string | undefined;
      for (const row of refRows) {
        const meta = row.metadata as BrandAssetMetadata;
        if (!meta || meta.source === "generated") {
          continue;
        }
        for (const hex of meta.palette ?? []) {
          palette.add(hex);
        }
        for (const s of meta.styleDescriptors ?? []) {
          styles.add(s);
        }
        if (!typography && meta.typography && meta.typography !== "unknown") {
          typography = meta.typography;
        }
      }

      const brandLines: Array<string> = [];
      if (palette.size > 0) {
        brandLines.push(`Brand palette: ${[...palette].join(", ")}.`);
      }
      if (styles.size > 0) {
        brandLines.push(`Brand style: ${[...styles].join(", ")}.`);
      }
      if (typography) {
        brandLines.push(`Typography hint: ${typography}.`);
      }
      const fullPrompt = `${prompt}\n\nAspect ratio: ${aspectRatio}.${brandLines.length > 0 ? `\n\n${brandLines.join(" ")}` : ""}`;

      const bytes = await generateBrandImageBytes({ aspectRatio, prompt: fullPrompt });
      const { assetId } = await ingestGeneratedAsset({
        bytes,
        mimeType: "image/png",
        orgId: ctx.orgId,
        prisma: ctx.prisma,
        prompt,
      });
      return { assetId, ok: true };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      logger.error({ error: message, orgId: ctx.orgId }, "generateBrandImage.failed");
      return { error: message, ok: false };
    }
  },
  id: "generateBrandImage",
  inputSchema: generateBrandImageInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
};

export { generateBrandImageSkill };
export type { GenerateBrandImageInput, GenerateBrandImageOutput };
```

- [ ] **Step 4: Verify the test passes**

```bash
pnpm --filter api test generate-brand-image
```

Expected: 4 tests pass.

- [ ] **Step 5: Register the skill**

Edit `apps/api/src/agents/skills/registry.ts`:

```ts
import { extractSoulSkill } from "./extract-soul";
import { generateBrandImageSkill } from "./generate-brand-image";
import { labelBrandAssetSkill } from "./label-brand-asset";

import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  extractSoulSkill as Skill<unknown, unknown>,
  generateBrandImageSkill as Skill<unknown, unknown>,
  labelBrandAssetSkill as Skill<unknown, unknown>,
];

export { ALL_SKILLS };
```

- [ ] **Step 6: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/generate-brand-image.ts apps/api/src/agents/skills/generate-brand-image.test.ts apps/api/src/agents/skills/registry.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 70 (66 + 4 generate-brand-image).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents/skills/generate-brand-image.ts apps/api/src/agents/skills/generate-brand-image.test.ts apps/api/src/agents/skills/registry.ts
git commit -m "feat(api): extract generateBrandImage skill into agents/skills/"
```

---

## Task 6: Wire `lib/ai.ts` runAgent to consume the registry

**Files:**

- Modify: `apps/api/src/lib/ai.ts` (replace the inline `tools` object literal with a registry-driven map; remove the now-dead skill-specific imports and Zod schemas)

The current `runAgent` in `apps/api/src/lib/ai.ts:141-261` defines `const tools = { extractSoul: tool({...}), generateBrandImage: tool({...}), labelBrandAsset: tool({...}) }`. Replace it with a mapping over `ALL_SKILLS`. The skill `execute` already accepts `(args, ctx)`, so the AI SDK adapter just wraps `(args) => skill.execute(args, ctx)`.

Lines to remove from `lib/ai.ts`:

- The three Zod schemas: `extractSoulToolInput`, `generateBrandImageToolInput`, `labelBrandAssetToolInput` (moved into the skill files).
- The three inline `tool({...})` definitions inside the `tools` literal.
- The imports `applySoulUpdate`, `ingestGeneratedAsset`, `generateBrandImageBytes` — they're now used only via the skill registry.
- The `BrandAssetMetadata` inferred type if it exists in lib/ai.

Lines to keep:

- `AGENT_SYSTEM_TEMPLATE` and the prompt helpers (Phase 5c will move them; not now).
- The step.content[] aggregation logic that walks tool calls/results.
- The `partialSoulSchema` export (handler.ts may use it; check before removing).
- The `runAgent` signature unchanged.

- [ ] **Step 1: Read the current lib/ai.ts**

```bash
cat apps/api/src/lib/ai.ts | head -80
```

Identify the exact lines containing the three Zod schemas and the `tools = { ... }` literal. The Zod schemas live at the top (around lines 41-59) and the `tools` object is inside `runAgent` (around lines 152-247).

- [ ] **Step 2: Replace the imports + tool definitions**

Apply these edits to `apps/api/src/lib/ai.ts`:

**Remove:**

```ts
import { ingestGeneratedAsset } from "../soul/brand-asset";
import { applySoulUpdate } from "../soul/apply";

import { generateBrandImageBytes } from "./image-gen";
```

**Add (after the remaining imports):**

```ts
import { ALL_SKILLS } from "../agents/skills/registry";
import type { SkillContext } from "../agents/skills/types";
```

**Remove the three input-schema declarations:**

```ts
const extractSoulToolInput = z.object({...});
const generateBrandImageToolInput = z.object({...});
const labelBrandAssetToolInput = z.object({...});
```

(They live in the skill files now; `lib/ai.ts` shouldn't need them.)

**Replace the `const tools = { ... }` block inside `runAgent`:**

```ts
const ctx: SkillContext = { orgId, prisma };
const tools = Object.fromEntries(
  ALL_SKILLS.map((skill) => [
    skill.id,
    tool({
      description: skill.description,
      execute: (args) => skill.execute(args, ctx),
      inputSchema: skill.inputSchema,
    }),
  ]),
);
```

(Keep the same `tool` import from `"ai"`. The variable `ctx` is built once per `runAgent` invocation; each skill receives it via closure.)

**Remove the now-unused `partialSoulSchema` export** if nothing imports it. Check first:

```bash
grep -rn "partialSoulSchema" apps/api/src
```

If `partialSoulSchema` is only referenced inside lib/ai.ts itself, delete the declaration and the `export { partialSoulSchema, runAgent }` shrinks to `export { runAgent }`. If something else imports it, leave it for now.

- [ ] **Step 3: Run lib/ai's existing tests**

```bash
pnpm --filter api test lib/ai
```

Existing assertions check `Object.keys(args.tools).toSorted()` and verify `toolCallSummary` aggregation. The new wiring uses skill IDs (`extractSoul`, `generateBrandImage`, `labelBrandAsset`) — the same keys as before, so the test should pass without modification.

Expected: all lib/ai tests pass.

If a test fails because `BrandAssetMetadata` was inferred via JSDoc somewhere, restore the type locally OR adjust the test mocks.

- [ ] **Step 4: Run all skill tests + full repo suite**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests still 70.

- [ ] **Step 5: Live-bot sanity check (lightweight)**

```bash
curl -s http://localhost:4000/healthz && echo
curl -s http://localhost:4000/readyz && echo
```

The dev server should have auto-restarted via tsdown watch. Both endpoints reachable.

- [ ] **Step 6: Format the changes**

```bash
pnpm exec oxfmt apps/api/src/lib/ai.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/ai.ts
git commit -m "refactor(api): drive runAgent tools from skills registry"
```

---

## Task 7: Rename `soul/` → `knowledge/`

**Files:**

- Rename folder: `apps/api/src/soul/` → `apps/api/src/knowledge/`
- Rename within: `apps/api/src/knowledge/knowledge-provider.ts` → `apps/api/src/knowledge/provider.ts` (+ corresponding `.test.ts`)
- Modify imports: every file referring to `../soul/...` or `./soul/...` updates to `../knowledge/...` / `./knowledge/...`
- Modify internal imports: anything inside knowledge/ referring to `./knowledge-provider` updates to `./provider`

- [ ] **Step 1: Inventory references**

```bash
grep -rn "from.*soul/" apps/api/src
grep -rn "from.*knowledge-provider" apps/api/src
```

The first command lists every file importing from `soul/`. The second catches the internal `./knowledge-provider` references that will need updating after the file rename. Note the file paths and line numbers — you'll update each.

- [ ] **Step 2: Git-mv the folder + the file**

```bash
git mv apps/api/src/soul apps/api/src/knowledge
git mv apps/api/src/knowledge/knowledge-provider.ts apps/api/src/knowledge/provider.ts
git mv apps/api/src/knowledge/knowledge-provider.test.ts apps/api/src/knowledge/provider.test.ts
git status --short
```

Expected output shows all soul/_ files as renamed (R) to knowledge/_, plus the inner file rename from knowledge-provider to provider.

- [ ] **Step 3: Update imports across the codebase**

Use `grep -rln "soul/" apps/api/src` to list affected files, then fix each. Expected files needing updates:

- `apps/api/src/lib/ai.ts` — should no longer have any `soul/` import after Task 6, but double-check.
- `apps/api/src/telegram/handler.ts` — imports from `../soul/*`. Update each path to `../knowledge/*`.
- `apps/api/src/agents/skills/extract-soul.ts` — imports `from "../../soul/apply"`. Update to `from "../../knowledge/apply"`.
- `apps/api/src/agents/skills/extract-soul.test.ts` — `vi.mock("../../soul/apply"...)`. Update to `vi.mock("../../knowledge/apply"...)`.
- `apps/api/src/agents/skills/generate-brand-image.ts` — imports `from "../../soul/brand-asset"`. Update.
- `apps/api/src/agents/skills/generate-brand-image.test.ts` — `vi.mock("../../soul/brand-asset"...)`. Update.
- `apps/api/src/knowledge/provider.test.ts` — internal import `from "./knowledge-provider"`. Update to `from "./provider"`.
- Any other files surfaced by `grep -rn "soul/" apps/api/src` after the rename.

Use the **Edit** tool with `replace_all: false` on each specific occurrence (to avoid replacing strings inside test descriptions or comments). Run grep before and after to verify zero residual references.

- [ ] **Step 4: Verify no residual soul/ references**

```bash
grep -rn "soul/" apps/api/src
grep -rn "knowledge-provider" apps/api/src
```

Both should print nothing. (The folder is now `knowledge/`, and the file is `provider.ts`.)

- [ ] **Step 5: Run gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests still 70.

If a test fails with "Cannot find module './knowledge-provider'" or "../soul/\*", you missed an import update. Use grep to find the leftover.

- [ ] **Step 6: Format any modified file**

```bash
pnpm exec oxfmt apps/api/src/telegram/handler.ts apps/api/src/agents/skills/extract-soul.ts apps/api/src/agents/skills/extract-soul.test.ts apps/api/src/agents/skills/generate-brand-image.ts apps/api/src/agents/skills/generate-brand-image.test.ts apps/api/src/knowledge/provider.test.ts
```

(Only format files you actually edited.)

- [ ] **Step 7: Commit**

```bash
git add -A apps/api/src/
git commit -m "refactor(api): rename soul/ to knowledge/ (incl. knowledge-provider → provider)"
```

The `-A` ensures both the renamed files and the modified-import files land in this single commit. Verify with `git show --stat HEAD` that only soul→knowledge renames + import-line updates appear — no unintended files.

---

## Task 8: Live bot smoke test + final gates + finishing

**Files:** none modified

- [ ] **Step 1: Final-gate run**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests 70.

- [ ] **Step 2: Confirm bot is healthy**

```bash
curl -s http://localhost:4000/healthz && echo
curl -s http://localhost:4000/readyz && echo
```

Both return success bodies. If the dev server died from the file moves, restart with `pnpm dev --filter=api`.

- [ ] **Step 3: Send a real message to @qolmeia_mvp_v0_bot**

Open Telegram, send something like:

```
oi, teste de skills extraction fase 5b
```

The bot should reply in pt-BR. Watch the dev server terminal for the `telegram message handled` log line — confirm `toolCallSummary` looks normal (no missing fields, no errors).

The reply doesn't have to mention skills; it just has to come back identical in shape to what worked before Phase 5b. Behavior must not change.

- [ ] **Step 4: Confirm no soul/ references remain in the entire codebase**

```bash
grep -rn "soul/" apps/api/src
grep -rn "knowledge-provider" apps/api/src
```

Both print nothing.

- [ ] **Step 5: Restore the stashed change from Task 1**

```bash
git stash list
git stash pop
git status --short
```

Expected: webhook.ts shows as `M` again. It stays in the working tree, uncommitted (as it has been across phases).

- [ ] **Step 6: Push the branch**

```bash
git push -u origin qolmeia-phase-5b-skills-extraction
```

- [ ] **Step 7: Hand off to finishing-a-development-branch**

Phase 5b is now complete on its own branch with 6 commits:

1. `feat(api): add Skill types and empty skills registry`
2. `feat(api): extract extractSoul skill into agents/skills/`
3. `feat(api): extract labelBrandAsset skill into agents/skills/`
4. `feat(api): extract generateBrandImage skill into agents/skills/`
5. `refactor(api): drive runAgent tools from skills registry`
6. `refactor(api): rename soul/ to knowledge/ (incl. knowledge-provider → provider)`

All gates green. Bot still replies live. Use `superpowers:finishing-a-development-branch` to merge / open PR / hold.

---

## Self-review notes

**Spec coverage (§5 code organization + §6 module responsibilities + §11 phase 5b):**

| Spec requirement                                                                                                                 | Implemented in      | Verified by                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `agents/skills/*` directory with `registry.ts` and one file per skill                                                            | Tasks 2–5           | Per-skill unit tests + grep file listing                             |
| Skill shape `{ id, displayName, description, inputSchema, requiresApprovalDefault, requiredConnectorTypes, execute(args, ctx) }` | Task 2 (`types.ts`) | typecheck + per-skill metadata assertions                            |
| `extractSoul`, `labelBrandAsset`, `generateBrandImage` moved out of `lib/ai.ts`                                                  | Tasks 3, 4, 5       | Per-skill tests + `grep` confirms `lib/ai.ts` no longer defines them |
| `lib/ai.ts` imports skills from registry                                                                                         | Task 6              | Existing lib/ai.test.ts still passes (verifies tool key names)       |
| `soul/` renamed to `knowledge/`                                                                                                  | Task 7              | `grep -rn "soul/" apps/api/src` empty                                |
| `knowledge-provider.ts` → `provider.ts`                                                                                          | Task 7              | `grep -rn "knowledge-provider" apps/api/src` empty                   |
| Bot behavior unchanged                                                                                                           | Task 8              | Live Telegram smoke test                                             |
| All existing tests pass after path updates                                                                                       | Task 7 + Task 8     | `pnpm test` green                                                    |
| No agent runtime changes (Phase 5c work)                                                                                         | n/a                 | `agents/runtime.ts` not created here                                 |
| No connector code (Phase 5c+ work)                                                                                               | n/a                 | `connectors/` folder not created here                                |

**Placeholder scan:** No "TBD", "TODO", "implement later", "appropriate", or "etc." in step bodies. Every code block is complete. Every command has expected behavior.

**Type consistency check:**

- Skill IDs use camelCase to match existing tool names: `extractSoul`, `labelBrandAsset`, `generateBrandImage`. The model sees these names unchanged across the refactor.
- File names use kebab-case: `extract-soul.ts`, `label-brand-asset.ts`, `generate-brand-image.ts`.
- `SkillContext` shape `{ orgId: string, prisma: PrismaClient }` is consistent across all three skill `execute` signatures.
- `requiredConnectorTypes` is `ReadonlyArray<ConnectorType>` everywhere — Phase 5c may tighten this to a single optional or non-empty array later if needed.
- The `extract.ts` re-export in soul/ moves to knowledge/extract.ts unchanged (it just re-exports `runAgent` from `lib/ai`).
- `partialSoulSchema` export from `lib/ai.ts` is checked-then-removed if dead in Task 6 Step 2; otherwise left in place. The plan does not silently remove it.

**Risk:** The `as Skill<unknown, unknown>` cast in `registry.ts` is the only piece of type weakness. Phase 5c should introduce a discriminated-union helper or a `defineSkill<T>()` factory to avoid the cast.
