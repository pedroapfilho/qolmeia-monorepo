# Phase 5c — Generic Runtime + Designer Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the generic agent runtime (`agents/runtime.ts`), the dispatcher seam (`agents/dispatcher.ts` with a `SerialDispatcher`), and the Designer `AgentTemplate` definition. Move the `AGENT_SYSTEM_TEMPLATE` string out of `lib/ai.ts` into `agents/templates/designer.ts`. Move the `runAgent` logic into `runtime.runAgentInstance` and parameterize on `AgentInstance`. Update `telegram/handler.ts` to lazy-create an `AgentInstance` for the org and dispatch via the new runtime. Delete `lib/ai.ts`. Bot behavior must stay identical.

**Architecture:** The Designer `AgentTemplate` lives in code (`agents/templates/designer.ts`); `syncTemplates` upserts it into the DB on startup. The `Skill` table is seeded by `syncSkills` (same pattern, with Zod-to-JSON-Schema rendering). The runtime loads the template + filtered skills per call via `AgentInstance.templateSlug` and `AgentInstance.enabledSkillIds` (null → use template defaults). The `AgentDispatcher` interface ships with one `SerialDispatcher` implementation that calls `runAgentInstance` inline; Phase 5g will swap it for `BullMQDispatcher` without touching call sites. The handler upserts the `AgentInstance` lazily per request (no separate migration), so this phase ships cleanly without a one-time data step. `lib/ai.ts` is deleted at the end — `runAgent` is gone.

**Tech Stack:** Vercel AI SDK v6 (`generateText`, `tool`, `gateway`, `stepCountIs`), Zod 4 (input schemas + `z.toJSONSchema` for the Skill row's `parametersJsonSchema` column), Prisma 7, Vitest 4.

**Builds on:** `main` HEAD `0f5470e` (after Phase 5b).

---

## File map

| File                                             | Action | Responsibility                                                                                                                                                                                        |
| ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/knowledge/apply.ts:5`              | Modify | Remove stale "Mirrors partialSoulSchema in lib/ai" comment (Phase 5b reviewer note)                                                                                                                   |
| `apps/api/src/knowledge/extract.ts`              | Delete | Dead 2-line re-export (Phase 5b reviewer note)                                                                                                                                                        |
| `apps/api/src/knowledge/extract.test.ts`         | Delete | Tests the deleted file                                                                                                                                                                                |
| `apps/api/src/agents/templates/types.ts`         | Create | `AgentTemplateDefinition` in-code type                                                                                                                                                                |
| `apps/api/src/agents/templates/designer.ts`      | Create | Designer template + `AGENT_SYSTEM_TEMPLATE` moved here                                                                                                                                                |
| `apps/api/src/agents/templates/registry.ts`      | Create | `ALL_TEMPLATES`, `findTemplateBySlug`, `syncTemplates(prisma)`                                                                                                                                        |
| `apps/api/src/agents/templates/registry.test.ts` | Create | Unit tests for findTemplateBySlug + syncTemplates upsert                                                                                                                                              |
| `apps/api/src/agents/skills/registry.ts`         | Modify | Add `findSkillById`, `syncSkills(prisma)`                                                                                                                                                             |
| `apps/api/src/agents/skills/registry.test.ts`    | Create | Unit tests for findSkillById + syncSkills upsert                                                                                                                                                      |
| `apps/api/src/agents/dispatcher.ts`              | Create | `AgentDispatcher` interface + `SerialDispatcher` implementation                                                                                                                                       |
| `apps/api/src/agents/dispatcher.test.ts`         | Create | Unit tests for SerialDispatcher                                                                                                                                                                       |
| `apps/api/src/agents/runtime.ts`                 | Create | `runAgentInstance({...}) → AgentRunResult`. Holds all helpers (renderAssetsBlock, renderExistingBlock, renderAgentSystem, buildAgentUserContent) + the generateText loop + step.content[] aggregation |
| `apps/api/src/agents/runtime.test.ts`            | Create | Unit tests for runAgentInstance: template resolution, skill filtering, tool wiring, step aggregation                                                                                                  |
| `apps/api/src/telegram/handler.ts`               | Modify | Lazy-create AgentInstance, dispatch via SerialDispatcher                                                                                                                                              |
| `apps/api/src/telegram/handler.test.ts`          | Modify | Update mocks: `runAgent` → `dispatcher.enqueueAndAwait`                                                                                                                                               |
| `apps/api/src/lib/ai.ts`                         | Delete | All logic moved to `agents/runtime.ts`; `runAgent` is gone                                                                                                                                            |
| `apps/api/src/lib/ai.test.ts`                    | Delete | Tests the deleted file                                                                                                                                                                                |
| `apps/api/src/index.ts`                          | Modify | Call `syncTemplates(prisma)` + `syncSkills(prisma)` at startup                                                                                                                                        |

**Files NOT touched in 5c:**

- The Phase 5a schema (already locked).
- The 3 skill files (`extract-soul.ts`, `label-brand-asset.ts`, `generate-brand-image.ts`) — their `execute` signatures stay `(args, ctx)` with `ctx = { orgId, prisma }`. Phase 5c does NOT introduce `agentInstanceId` into `SkillContext` yet (that's a Phase 5d/5f concern when the approval queue lands).
- `connectors/*` — Phase 5h.
- `agents/actions.ts`, `agents/delegation.ts` — Phase 5d (Controller + delegation) and 5f (AgentAction lifecycle).
- BullMQ dispatcher — Phase 5g.

---

## Task 1: Setup — branch, baseline, stash unrelated dirty file

**Files:** none modified

- [ ] **Step 1: Verify current branch and HEAD**

```bash
git status --porcelain && git log --oneline -1
```

Expected: HEAD is `0f5470e refactor(api): rename soul/ to knowledge/ (incl. knowledge-provider → provider)`. `git status` may show `apps/api/src/routes/telegram/webhook.ts` as `M` — that's the unrelated change Pedro carries.

- [ ] **Step 2: Stash the unrelated dirty file**

```bash
git stash push -m "phase-5c-precheck-webhook-comment" apps/api/src/routes/telegram/webhook.ts
git status --porcelain
```

Expected: clean working tree.

- [ ] **Step 3: Confirm docker + Postgres + Redis are up**

```bash
docker compose ps --format "table {{.Service}}\t{{.Status}}"
```

Both rows show `Up (healthy)`. Run `docker compose up -d` if not.

- [ ] **Step 4: Confirm baseline gates**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Each exits 0. Tests: 70 (66 api + 4 db).

- [ ] **Step 5: Confirm bot is healthy**

```bash
curl -s http://localhost:4000/healthz && echo
```

Returns `"status":"healthy"`. Start the dev server with `pnpm dev --filter=api` if needed; keep that terminal alive for Task 10.

- [ ] **Step 6: Branch off main**

```bash
git checkout main
git checkout -b qolmeia-phase-5c-runtime-and-designer
git branch --show-current
```

---

## Task 2: Clean up Phase 5b follow-ups

The Phase 5b final reviewer flagged: (a) the stale comment in `knowledge/apply.ts:5` referencing a deleted symbol, and (b) `knowledge/extract.ts` being a dead 2-line re-export. Fix both here so they don't clutter Phase 5c's diff.

**Files:**

- Modify: `apps/api/src/knowledge/apply.ts` (delete one comment line)
- Delete: `apps/api/src/knowledge/extract.ts`
- Delete: `apps/api/src/knowledge/extract.test.ts`

- [ ] **Step 1: Confirm `knowledge/extract.ts` has no remaining importers**

```bash
grep -rn "from.*knowledge/extract" apps/api/src
grep -rn "from.*agents/extract" apps/api/src
```

Both should print nothing. (If anything imports from `knowledge/extract`, STOP and investigate before deleting.)

- [ ] **Step 2: Remove the stale comment in `knowledge/apply.ts`**

Open the file and find line 5 — the comment:

```ts
// Mirrors partialSoulSchema in lib/ai — keep in sync if soul fields change.
```

Delete that single line. The `type PartialSoul = { ... }` declaration directly below is now the canonical definition; the comment misleads.

- [ ] **Step 3: Delete the dead files**

```bash
git rm apps/api/src/knowledge/extract.ts apps/api/src/knowledge/extract.test.ts
```

- [ ] **Step 4: Verify gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Test count drops by 1 (the extract.test.ts had a single smoke test) — expect 69 total (65 api + 4 db).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/knowledge/apply.ts
git commit -m "chore(api): remove dead knowledge/extract re-export and stale apply.ts comment"
```

Note: `git rm` already staged the deletions, so the `git add` here only stages the comment fix; the commit captures all three.

---

## Task 3: AgentTemplate code types + Designer template + templates registry

**Files to create:**

- `apps/api/src/agents/templates/types.ts`
- `apps/api/src/agents/templates/designer.ts`
- `apps/api/src/agents/templates/registry.ts`

The in-code template type carries everything `syncTemplates` will push into the DB row, plus a `defaultEnabledSkillIds` array that the runtime uses to filter the skill registry.

- [ ] **Step 1: Create `apps/api/src/agents/templates/types.ts`**

```ts
import type { ConnectorType } from "@repo/db";

type AgentTemplateDefinition = {
  canDelegateTo: ReadonlyArray<string>;
  compatibleInboundConnectorTypes: ReadonlyArray<ConnectorType>;
  compatibleOutboundConnectorTypes: ReadonlyArray<ConnectorType>;
  defaultBudgetCents: number;
  defaultEnabledSkillIds: ReadonlyArray<string>;
  defaultMission: string;
  defaultSystemPrompt: string;
  description: string;
  displayName: string;
  slug: string;
};

export type { AgentTemplateDefinition };
```

- [ ] **Step 2: Create `apps/api/src/agents/templates/designer.ts`**

The `defaultSystemPrompt` is the exact `AGENT_SYSTEM_TEMPLATE` string currently in `apps/api/src/lib/ai.ts:29-55`. Copy it verbatim — every character, every accent, every line break.

```ts
import type { AgentTemplateDefinition } from "./types";

const DESIGNER_SYSTEM_PROMPT = `Você é um assistente onboarding de negócio. O dono fala com você por texto, áudio ou imagem em português brasileiro.

Você tem 3 ferramentas:
1) extractSoul — chame quando a mensagem trouxer informação sobre o negócio (5 campos: whatYouDo, targetAudience, differentiator, brandVoice, location).
2) generateBrandImage — chame APENAS quando o dono pedir explicitamente uma imagem ou criação visual. Máximo 1 chamada por mensagem. Passe o prompt descritivo e o aspectRatio desejado.
3) labelBrandAsset — chame UMA VEZ por assetId listado em "Novos assets nesta mensagem". Olhe a imagem correspondente e extraia palette (até 8 hex), styleDescriptors (até 6, em pt-BR), e typography.

Perfil atual:
{{currentContext}}

Assets de marca já anotados:
{{existingAssetsBlock}}

Novos assets nesta mensagem (já salvos no R2, aguardando label):
{{newAssetsBlock}}

Imagens grandes ignoradas (> 20 MB): {{oversizeCount}}

Depois de chamar as ferramentas necessárias, escreva UMA resposta em pt-BR (1-3 frases, máx 500 caracteres) — não chame ferramentas dentro do texto da resposta:
- Se brandVoice está preenchido no perfil, adote esse tom.
- Acknowledge cada asset novo citando o que viu (cores, estilo).
- Se houver oversize, mencione: "Alguma imagem não coube; tenta menor?".
- Se a mensagem trouxer info do perfil, agradeça e peça naturalmente um campo soul que ainda falte.
- Se o perfil já está completo, responda usando APENAS o perfil + assets conhecidos.
- Se gerou imagem, confirme com entusiasmo e descreva brevemente o que foi criado.
- Se for fora do tema, redirecione com gentileza.
- Nunca invente fatos.`;

const designerTemplate: AgentTemplateDefinition = {
  canDelegateTo: [],
  compatibleInboundConnectorTypes: ["TELEGRAM"],
  compatibleOutboundConnectorTypes: ["TELEGRAM"],
  defaultBudgetCents: 0,
  defaultEnabledSkillIds: ["extractSoul", "generateBrandImage", "labelBrandAsset"],
  defaultMission: "",
  defaultSystemPrompt: DESIGNER_SYSTEM_PROMPT,
  description:
    "Agente de design e marca: captura o perfil do negócio, anota assets enviados, gera imagens.",
  displayName: "Designer",
  slug: "designer",
};

export { designerTemplate };
```

- [ ] **Step 3: Create `apps/api/src/agents/templates/registry.ts`**

For Phase 5c the registry exports `ALL_TEMPLATES`, `findTemplateBySlug`, and `syncTemplates`. `syncTemplates` upserts each template into the DB and sets the M:N `skills` link via `set: [{id: ...}, ...]`. Phase 5d will add `validateCanDelegateToAcyclic`; for now `designer.canDelegateTo = []` so there's nothing to validate.

```ts
import type { PrismaClient } from "@repo/db";

import { designerTemplate } from "./designer";

import type { AgentTemplateDefinition } from "./types";

const ALL_TEMPLATES: ReadonlyArray<AgentTemplateDefinition> = [designerTemplate];

const findTemplateBySlug = (slug: string): AgentTemplateDefinition | undefined =>
  ALL_TEMPLATES.find((t) => t.slug === slug);

const syncTemplates = async (prisma: Pick<PrismaClient, "agentTemplate">): Promise<void> => {
  for (const template of ALL_TEMPLATES) {
    const baseFields = {
      canDelegateTo: [...template.canDelegateTo],
      compatibleInboundConnectorTypes: [...template.compatibleInboundConnectorTypes],
      compatibleOutboundConnectorTypes: [...template.compatibleOutboundConnectorTypes],
      defaultBudgetCents: template.defaultBudgetCents,
      defaultMission: template.defaultMission,
      defaultSystemPrompt: template.defaultSystemPrompt,
      description: template.description,
      displayName: template.displayName,
    };
    await prisma.agentTemplate.upsert({
      create: {
        ...baseFields,
        skills: { connect: template.defaultEnabledSkillIds.map((id) => ({ id })) },
        slug: template.slug,
      },
      update: {
        ...baseFields,
        skills: { set: template.defaultEnabledSkillIds.map((id) => ({ id })) },
      },
      where: { slug: template.slug },
    });
  }
};

export { ALL_TEMPLATES, findTemplateBySlug, syncTemplates };
```

- [ ] **Step 4: Verify no behavior regression yet**

```bash
pnpm exec oxfmt apps/api/src/agents/templates/types.ts apps/api/src/agents/templates/designer.ts apps/api/src/agents/templates/registry.ts
pnpm typecheck
pnpm lint
pnpm test
```

All exit 0. Total tests still 69 (no tests added yet — Task 3 doesn't include tests for registry; Task 4 adds them as part of the syncTemplates/syncSkills work).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/templates/types.ts apps/api/src/agents/templates/designer.ts apps/api/src/agents/templates/registry.ts
git commit -m "feat(api): add Designer AgentTemplate and templates registry"
```

---

## Task 4: syncTemplates + syncSkills functions with unit tests

**Files to modify:**

- `apps/api/src/agents/skills/registry.ts` (add `findSkillById` + `syncSkills`)

**Files to create:**

- `apps/api/src/agents/skills/registry.test.ts`
- `apps/api/src/agents/templates/registry.test.ts`

The skill registry needs a lookup helper for the runtime (`findSkillById`) and a `syncSkills` function that upserts each skill into the DB. `parametersJsonSchema` is rendered from the Zod schema via `z.toJSONSchema(skill.inputSchema)`.

- [ ] **Step 1: Confirm Zod 4 exposes `z.toJSONSchema`**

```bash
grep -E '"zod"' apps/api/package.json
```

Confirm zod is `^4.x.x` (Zod 4). `z.toJSONSchema(zodSchema)` is the built-in renderer in Zod 4.

If `z.toJSONSchema` isn't available, fall back: store an empty `{}` object as `parametersJsonSchema` (Skill's column is `Json`, accepts anything). Note this in the commit message and add a TODO in the registry file pointing at the gap. Phase 5d/UI will need a real renderer eventually.

- [ ] **Step 2: Extend `apps/api/src/agents/skills/registry.ts`**

Replace its current contents with:

```ts
import type { PrismaClient } from "@repo/db";
import { z } from "zod";

import { extractSoulSkill } from "./extract-soul";
import { generateBrandImageSkill } from "./generate-brand-image";
import { labelBrandAssetSkill } from "./label-brand-asset";

import type { Skill } from "./types";

const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  extractSoulSkill as Skill<unknown, unknown>,
  generateBrandImageSkill as Skill<unknown, unknown>,
  labelBrandAssetSkill as Skill<unknown, unknown>,
];

const findSkillById = (id: string): Skill<unknown, unknown> | undefined =>
  ALL_SKILLS.find((s) => s.id === id);

const renderSchema = (schema: Skill<unknown, unknown>["inputSchema"]): object => {
  // Zod 4 exposes z.toJSONSchema as a top-level helper. If at runtime this
  // throws (older Zod or unsupported schema feature), the catch returns {}
  // so syncSkills still proceeds — the Skill table column is informational
  // for future admin tooling, never consumed by the runtime.
  try {
    return z.toJSONSchema(schema) as object;
  } catch {
    return {};
  }
};

const syncSkills = async (prisma: Pick<PrismaClient, "skill">): Promise<void> => {
  for (const skill of ALL_SKILLS) {
    const baseFields = {
      description: skill.description,
      displayName: skill.displayName,
      parametersJsonSchema: renderSchema(skill.inputSchema),
      requiredConnectorTypes: [...skill.requiredConnectorTypes],
      requiresApprovalDefault: skill.requiresApprovalDefault,
    };
    await prisma.skill.upsert({
      create: { ...baseFields, id: skill.id },
      update: baseFields,
      where: { id: skill.id },
    });
  }
};

export { ALL_SKILLS, findSkillById, syncSkills };
```

- [ ] **Step 3: Create `apps/api/src/agents/skills/registry.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

import { ALL_SKILLS, findSkillById, syncSkills } from "./registry";

describe("skill registry", () => {
  it("exports the 3 Phase 5b skills", () => {
    const ids = ALL_SKILLS.map((s) => s.id).toSorted();
    expect(ids).toEqual(["extractSoul", "generateBrandImage", "labelBrandAsset"]);
  });

  it("findSkillById returns the matching skill or undefined", () => {
    expect(findSkillById("extractSoul")?.id).toBe("extractSoul");
    expect(findSkillById("nonexistent")).toBeUndefined();
  });

  it("syncSkills upserts each skill into the Skill table with rendered JSON schema", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const fakePrisma = { skill: { upsert } } as never;

    await syncSkills(fakePrisma);

    expect(upsert).toHaveBeenCalledTimes(3);
    const firstCallArg = upsert.mock.calls[0]![0] as {
      create: {
        description: string;
        displayName: string;
        id: string;
        parametersJsonSchema: object;
      };
      update: { description: string };
      where: { id: string };
    };
    expect(firstCallArg.where).toEqual({ id: firstCallArg.create.id });
    expect(firstCallArg.create.parametersJsonSchema).toBeTypeOf("object");
    expect(firstCallArg.create.displayName.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Create `apps/api/src/agents/templates/registry.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

import { ALL_TEMPLATES, findTemplateBySlug, syncTemplates } from "./registry";

describe("templates registry", () => {
  it("exports the Designer template", () => {
    const slugs = ALL_TEMPLATES.map((t) => t.slug);
    expect(slugs).toContain("designer");
  });

  it("findTemplateBySlug returns matching template or undefined", () => {
    expect(findTemplateBySlug("designer")?.slug).toBe("designer");
    expect(findTemplateBySlug("nonexistent")).toBeUndefined();
  });

  it("Designer template carries the system-prompt placeholders the runtime expects", () => {
    const designer = findTemplateBySlug("designer");
    expect(designer).toBeDefined();
    if (!designer) {
      return;
    }
    expect(designer.defaultSystemPrompt).toContain("{{currentContext}}");
    expect(designer.defaultSystemPrompt).toContain("{{existingAssetsBlock}}");
    expect(designer.defaultSystemPrompt).toContain("{{newAssetsBlock}}");
    expect(designer.defaultSystemPrompt).toContain("{{oversizeCount}}");
    expect(designer.defaultEnabledSkillIds).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
    ]);
  });

  it("syncTemplates upserts each template with skill connections", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const fakePrisma = { agentTemplate: { upsert } } as never;

    await syncTemplates(fakePrisma);

    expect(upsert).toHaveBeenCalledTimes(ALL_TEMPLATES.length);
    const designerCall = upsert.mock.calls.find(
      ([arg]: [{ where: { slug: string } }]) => arg.where.slug === "designer",
    );
    expect(designerCall).toBeDefined();
    const arg = (designerCall as Array<unknown>)[0] as {
      create: { skills: { connect: Array<{ id: string }> }; slug: string };
      update: { skills: { set: Array<{ id: string }> } };
    };
    expect(arg.create.skills.connect.map((c) => c.id).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
    ]);
    expect(arg.update.skills.set.map((c) => c.id).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
    ]);
  });
});
```

- [ ] **Step 5: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/registry.ts apps/api/src/agents/skills/registry.test.ts apps/api/src/agents/templates/registry.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 76 (69 + 3 skills/registry + 4 templates/registry).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/skills/registry.ts apps/api/src/agents/skills/registry.test.ts apps/api/src/agents/templates/registry.test.ts
git commit -m "feat(api): add syncSkills + syncTemplates with findSkillById + findTemplateBySlug"
```

---

## Task 5: Wire syncTemplates + syncSkills into API startup

**Files:**

- Modify: `apps/api/src/index.ts`

`syncSkills` MUST run BEFORE `syncTemplates` because the M:N `skills` connection on a template references existing Skill rows. Both are idempotent — safe on every boot.

- [ ] **Step 1: Edit `apps/api/src/index.ts`**

Find the import block at the top. Add (alphabetically sorted into the existing groups):

```ts
import { syncSkills } from "./agents/skills/registry";
import { syncTemplates } from "./agents/templates/registry";
```

Find the line `logger.info({...}, "🚀 Starting server...");` (around line 160). Immediately BEFORE the `serve({...})` call below it, insert:

```ts
await syncSkills(prisma);
await syncTemplates(prisma);
logger.info("Skill and template registries synced.");
```

This runs both at the top level of the module (legal because `index.ts` already uses top-level await for `createMarkdownFromOpenApi`).

- [ ] **Step 2: Restart the dev server**

If it's still running, save the file — tsdown will hot-reload. Watch the terminal for:

```
{"level":30,...,"msg":"Skill and template registries synced."}
```

If it crashes (e.g., the Skill rows weren't seeded yet), check that `pnpm db:push` ran successfully in Phase 5a (the tables exist).

- [ ] **Step 3: Verify the rows landed**

```bash
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT id, \"displayName\" FROM \"Skill\" ORDER BY id;"
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT slug, \"displayName\", \"canDelegateTo\" FROM \"AgentTemplate\";"
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT \"A\", \"B\" FROM \"_TemplateSkills\" ORDER BY \"A\";"
```

Expected:

- Skill: 3 rows (`extractSoul`, `generateBrandImage`, `labelBrandAsset`).
- AgentTemplate: 1 row (`designer`).
- `_TemplateSkills`: 3 rows (the M:N join linking designer to all 3 skills). Column `A` is `AgentTemplate.slug`, `B` is `Skill.id` (or vice versa — Prisma names them implicitly).

If counts are wrong, re-read the `syncTemplates`/`syncSkills` implementation in Task 4 against the actual logs.

- [ ] **Step 4: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/index.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests still 76.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): sync skills + templates at API startup"
```

---

## Task 6: AgentDispatcher interface + SerialDispatcher

**Files to create:**

- `apps/api/src/agents/dispatcher.ts`
- `apps/api/src/agents/dispatcher.test.ts`

The dispatcher is the seam Phase 5g swaps for BullMQ. For 5c it's just a Promise-returning wrapper: `enqueueAndAwait(args)` calls `runAgentInstance(args)` inline.

**Important:** `dispatcher.ts` cannot import `runtime.ts` directly because `runtime.ts` does not exist until Task 7. To break this circularity, the dispatcher takes the runtime function via dependency injection at construction time. The handler (Task 8) constructs the dispatcher with `runAgentInstance` from `runtime.ts`.

- [ ] **Step 1: Create `apps/api/src/agents/dispatcher.ts`**

```ts
import type { AgentInstance, PrismaClient } from "@repo/db";

type AgentRunInput = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  imageBytes: ReadonlyArray<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
  text?: string;
};

type AssetSummary = {
  assetId: string;
  deduped: boolean;
  mimeType: string;
};

type ExistingAssetSummary = {
  assetId: string;
  metadata: unknown;
  mimeType: string;
};

type AgentRunResult = {
  generatedAssetIds: ReadonlyArray<string>;
  text: string;
  toolCallSummary: Record<string, number>;
  usage: { inputTokens: number; outputTokens: number };
};

type AgentDispatchArgs = {
  agentInstance: AgentInstance;
  currentContext: string;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  input: AgentRunInput;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
  prisma: PrismaClient;
};

type AgentRunner = (args: AgentDispatchArgs) => Promise<AgentRunResult>;

type AgentDispatcher = {
  enqueueAndAwait: (args: AgentDispatchArgs) => Promise<AgentRunResult>;
};

const createSerialDispatcher = (runner: AgentRunner): AgentDispatcher => ({
  enqueueAndAwait: (args) => runner(args),
});

export { createSerialDispatcher };
export type {
  AgentDispatcher,
  AgentDispatchArgs,
  AgentRunInput,
  AgentRunner,
  AgentRunResult,
  AssetSummary,
  ExistingAssetSummary,
};
```

The dispatcher types `AgentRunInput`, `AgentRunResult`, `AssetSummary`, `ExistingAssetSummary` are exported from here because `runtime.ts` (Task 7) and `handler.ts` (Task 8) both import them.

- [ ] **Step 2: Create `apps/api/src/agents/dispatcher.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

import { createSerialDispatcher } from "./dispatcher";

import type { AgentDispatchArgs, AgentRunResult } from "./dispatcher";

describe("createSerialDispatcher", () => {
  it("forwards the args to the runner and returns its result", async () => {
    const fakeResult: AgentRunResult = {
      generatedAssetIds: [],
      text: "ok",
      toolCallSummary: {},
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const runner = vi.fn().mockResolvedValue(fakeResult);
    const dispatcher = createSerialDispatcher(runner);

    const args = {
      agentInstance: { id: "ai_1" },
      currentContext: "",
      existingAssets: [],
      input: { imageBytes: [], text: "hi" },
      newAssets: [],
      oversizeCount: 0,
      prisma: {},
    } as unknown as AgentDispatchArgs;

    const result = await dispatcher.enqueueAndAwait(args);

    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(args);
    expect(result).toBe(fakeResult);
  });

  it("propagates rejections from the runner", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("boom"));
    const dispatcher = createSerialDispatcher(runner);
    await expect(dispatcher.enqueueAndAwait({} as unknown as AgentDispatchArgs)).rejects.toThrow(
      "boom",
    );
  });
});
```

- [ ] **Step 3: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/dispatcher.ts apps/api/src/agents/dispatcher.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 78 (76 + 2).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/dispatcher.ts apps/api/src/agents/dispatcher.test.ts
git commit -m "feat(api): add AgentDispatcher interface and SerialDispatcher"
```

---

## Task 7: agents/runtime.ts — runAgentInstance

**Files to create:**

- `apps/api/src/agents/runtime.ts`
- `apps/api/src/agents/runtime.test.ts`

The runtime accepts an `AgentInstance`, resolves the template by `templateSlug`, filters skills by `enabledSkillIds` (null → template defaults), builds the system prompt by substituting `{{...}}` placeholders, calls `generateText`, and aggregates `step.content[]`. This is a near-verbatim port of `runAgent` from `lib/ai.ts` with the parameterization on AgentInstance.

- [ ] **Step 1: Write the runtime test first (covers wiring + skill filtering)**

Create `apps/api/src/agents/runtime.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn(() => ({})),
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
  tool: vi.fn((t: unknown) => t),
}));

import { generateText } from "ai";

import { runAgentInstance } from "./runtime";

const mockedGenerateText = vi.mocked(generateText as unknown as ReturnType<typeof vi.fn>);

describe("runAgentInstance", () => {
  it("loads the Designer template, builds the system prompt, and wires all 3 skills", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "Olá!",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    } as never);

    const prisma = {
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;

    const agentInstance = {
      enabledSkillIds: null, // use template defaults
      id: "ai_1",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    const result = await runAgentInstance({
      agentInstance,
      currentContext: "",
      existingAssets: [],
      input: { imageBytes: [], text: "oi" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
    });

    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const args = mockedGenerateText.mock.calls[0]![0] as {
      system: string;
      tools: Record<string, unknown>;
    };
    expect(Object.keys(args.tools).toSorted()).toEqual([
      "extractSoul",
      "generateBrandImage",
      "labelBrandAsset",
    ]);
    expect(args.system).toContain("(perfil vazio)");
    expect(args.system).toContain("Você é um assistente onboarding");
    expect(result.text).toBe("Olá!");
    expect(result.usage.inputTokens).toBe(10);
  });

  it("respects enabledSkillIds when set (overrides template defaults)", async () => {
    mockedGenerateText.mockResolvedValue({
      text: ".",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = {
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;

    const agentInstance = {
      enabledSkillIds: ["extractSoul"], // only this one
      id: "ai_2",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    await runAgentInstance({
      agentInstance,
      currentContext: "",
      existingAssets: [],
      input: { imageBytes: [], text: "oi" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
    });

    const args = mockedGenerateText.mock.calls.at(-1)![0] as { tools: Record<string, unknown> };
    expect(Object.keys(args.tools)).toEqual(["extractSoul"]);
  });

  it("throws when the agent's templateSlug isn't in the registry", async () => {
    const prisma = { brandAsset: { findMany: vi.fn(), update: vi.fn() } } as never;
    const agentInstance = {
      enabledSkillIds: null,
      id: "ai_3",
      mission: "",
      orgId: "org_1",
      templateSlug: "ghost-template",
    } as never;

    await expect(
      runAgentInstance({
        agentInstance,
        currentContext: "",
        existingAssets: [],
        input: { imageBytes: [], text: "oi" },
        newAssets: [],
        oversizeCount: 0,
        prisma,
      }),
    ).rejects.toThrow(/template/iv);
  });

  it("aggregates tool calls + results across all agent steps via step.content[]", async () => {
    mockedGenerateText.mockResolvedValue({
      steps: [
        {
          content: [
            { toolName: "generateBrandImage", type: "tool-call" },
            {
              output: { assetId: "asset_gen_1", ok: true },
              toolName: "generateBrandImage",
              type: "tool-result",
            },
          ],
        },
        { content: [] },
      ],
      text: "Pronto.",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = {
      brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    } as never;
    const agentInstance = {
      enabledSkillIds: null,
      id: "ai_4",
      mission: "",
      orgId: "org_1",
      templateSlug: "designer",
    } as never;

    const result = await runAgentInstance({
      agentInstance,
      currentContext: "",
      existingAssets: [],
      input: { imageBytes: [], text: "gera uma imagem" },
      newAssets: [],
      oversizeCount: 0,
      prisma,
    });

    expect(result.generatedAssetIds).toEqual(["asset_gen_1"]);
    expect(result.toolCallSummary.generateBrandImage).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test → must FAIL (runtime.ts doesn't exist)**

```bash
pnpm --filter api test runtime
```

- [ ] **Step 3: Create `apps/api/src/agents/runtime.ts`**

```ts
import { gateway, generateText, stepCountIs, tool } from "ai";

import { ALL_SKILLS, findSkillById } from "./skills/registry";
import { findTemplateBySlug } from "./templates/registry";

import type { Skill, SkillContext } from "./skills/types";
import type {
  AgentDispatchArgs,
  AgentRunResult,
  AssetSummary,
  ExistingAssetSummary,
} from "./dispatcher";

const renderAssetsBlock = (assets: ReadonlyArray<AssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map(
      (a) =>
        `- assetId: ${a.assetId}, mimeType: ${a.mimeType}${a.deduped ? " (já estava no perfil — NÃO labelar)" : ""}`,
    )
    .join("\n");
};

const renderExistingBlock = (assets: ReadonlyArray<ExistingAssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map(
      (a) =>
        `- assetId: ${a.assetId}, mimeType: ${a.mimeType}, metadata: ${JSON.stringify(a.metadata)}`,
    )
    .join("\n");
};

const renderSystemPrompt = (
  template: string,
  args: {
    currentContext: string;
    existingAssets: ReadonlyArray<ExistingAssetSummary>;
    newAssets: ReadonlyArray<AssetSummary>;
    oversizeCount: number;
  },
): string =>
  template
    .replace(
      "{{currentContext}}",
      args.currentContext.length > 0 ? args.currentContext : "(perfil vazio)",
    )
    .replace("{{existingAssetsBlock}}", renderExistingBlock(args.existingAssets))
    .replace("{{newAssetsBlock}}", renderAssetsBlock(args.newAssets))
    .replace("{{oversizeCount}}", String(args.oversizeCount));

const buildUserContent = (input: AgentDispatchArgs["input"]) => {
  const parts: Array<
    { data: Uint8Array; mediaType: string; type: "file" } | { text: string; type: "text" }
  > = [];
  if (input.audioBytes) {
    parts.push({ data: input.audioBytes, mediaType: input.audioMime ?? "audio/ogg", type: "file" });
  }
  for (const img of input.imageBytes) {
    parts.push({ data: img.bytes, mediaType: img.mimeType, type: "file" });
  }
  if (input.text && input.text.length > 0) {
    parts.push({ text: input.text, type: "text" });
  }
  if (parts.length === 0) {
    parts.push({ text: "(sem conteúdo)", type: "text" });
  }
  return parts;
};

const resolveEnabledSkills = (
  enabledSkillIds: unknown,
  templateDefaultSkillIds: ReadonlyArray<string>,
): ReadonlyArray<Skill<unknown, unknown>> => {
  // enabledSkillIds is Json? on AgentInstance: null = use template defaults,
  // [] = explicit empty (no skills), [...] = explicit override.
  const ids: ReadonlyArray<string> =
    enabledSkillIds === null || enabledSkillIds === undefined
      ? templateDefaultSkillIds
      : (enabledSkillIds as ReadonlyArray<string>);
  const resolved: Array<Skill<unknown, unknown>> = [];
  for (const id of ids) {
    const skill = findSkillById(id);
    if (skill) {
      resolved.push(skill);
    }
  }
  return resolved;
};

const runAgentInstance = async (args: AgentDispatchArgs): Promise<AgentRunResult> => {
  const { agentInstance, currentContext, existingAssets, input, newAssets, oversizeCount, prisma } =
    args;

  const template = findTemplateBySlug(agentInstance.templateSlug);
  if (!template) {
    throw new Error(`Unknown agent template: ${agentInstance.templateSlug}`);
  }

  const skills = resolveEnabledSkills(
    agentInstance.enabledSkillIds,
    template.defaultEnabledSkillIds,
  );

  const ctx: SkillContext = { orgId: agentInstance.orgId, prisma };
  const tools = Object.fromEntries(
    skills.map((skill) => [
      skill.id,
      tool({
        description: skill.description,
        execute: (toolInput: unknown) => skill.execute(toolInput, ctx),
        inputSchema: skill.inputSchema,
      }),
    ]),
  );

  const baseSystem = renderSystemPrompt(template.defaultSystemPrompt, {
    currentContext,
    existingAssets,
    newAssets,
    oversizeCount,
  });
  const system =
    agentInstance.mission.length > 0
      ? `${baseSystem}\n\nMissão deste agente:\n${agentInstance.mission}`
      : baseSystem;

  const result = await generateText({
    messages: [{ content: buildUserContent(input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    stopWhen: stepCountIs(5),
    system,
    temperature: 0.2,
    tools,
  });

  // Aggregate tool calls/results across ALL agent steps. AI SDK v6's
  // top-level result.toolCalls / result.toolResults only contain the LAST
  // step's entries — when the model calls a tool in step 1 then writes text
  // in step 2, those arrays are empty. The actual per-step data lives in
  // step.content[] as discriminated items. Tool return values are under
  // `output`, not `result`.
  type StepContentItem = {
    output?: { assetId?: string; ok?: boolean };
    toolName?: string;
    type: string;
  };
  type StepShape = { content?: Array<StepContentItem> };
  const steps = (result as { steps?: Array<StepShape> }).steps ?? [];

  const summary: Record<string, number> = Object.fromEntries(ALL_SKILLS.map((s) => [s.id, 0]));
  const generatedAssetIds: Array<string> = [];
  for (const step of steps) {
    for (const item of step.content ?? []) {
      if (item.type === "tool-call" && item.toolName && item.toolName in summary) {
        summary[item.toolName] = (summary[item.toolName] ?? 0) + 1;
        continue;
      }
      if (
        item.type === "tool-result" &&
        item.toolName === "generateBrandImage" &&
        item.output?.ok === true &&
        item.output.assetId
      ) {
        generatedAssetIds.push(item.output.assetId);
      }
    }
  }

  return {
    generatedAssetIds,
    text: result.text,
    toolCallSummary: summary,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { runAgentInstance };
```

- [ ] **Step 4: Run the test → must PASS**

```bash
pnpm --filter api test runtime
```

Expected: 4 tests pass.

If a test fails because the runtime expects a different mock shape than the test provides, do NOT relax the test — investigate the runtime instead.

- [ ] **Step 5: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/runtime.ts apps/api/src/agents/runtime.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 82 (78 + 4).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/runtime.ts apps/api/src/agents/runtime.test.ts
git commit -m "feat(api): add agents/runtime.ts with runAgentInstance"
```

---

## Task 8: Update handler.ts to lazy-create AgentInstance + use the dispatcher

**Files:**

- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts` (existing mocks update)

The handler:

1. Replaces `runAgent` import with `createSerialDispatcher` + `runAgentInstance`.
2. After resolving `link.orgId`, upserts an `AgentInstance` with `templateSlug = "designer"` for that org.
3. Constructs the dispatcher once (per request — cheap) with `runAgentInstance` as the runner.
4. Calls `dispatcher.enqueueAndAwait({ agentInstance, ... })` instead of `runAgent({...})`.

For testability, the handler's `HandlerDeps` exposes the `dispatcher` factory as an injection point. Default is the SerialDispatcher wired to `runAgentInstance`.

- [ ] **Step 1: Modify `apps/api/src/telegram/handler.ts`**

Replace these imports:

```ts
import { runAgent as runAgentDefault } from "../lib/ai";
```

With:

```ts
import { createSerialDispatcher } from "../agents/dispatcher";
import { runAgentInstance } from "../agents/runtime";

import type { AgentDispatcher } from "../agents/dispatcher";
```

Replace these dependency injection points in `HandlerDeps`:

```ts
  runAgent?: typeof runAgentDefault;
```

With:

```ts
  dispatcher?: AgentDispatcher;
```

Update the `prisma` Pick to include `agentInstance`:

```ts
prisma: Pick<
  PrismaClient,
  | "$transaction"
  | "agentInstance"
  | "brandAsset"
  | "conversation"
  | "message"
  | "organization"
  | "telegramLink"
  | "webhookEvent"
>;
```

Inside `handleIncomingMessage`, replace the destructuring `runAgent = runAgentDefault` with:

```ts
const {
  dispatcher = createSerialDispatcher(runAgentInstance),
  fetchAsset: doFetch = fetchAssetDefault,
  getBusinessContext = getBusinessContextDefault,
  ingestBrandAsset = ingestBrandAssetDefault,
  prisma,
} = deps;
```

Right BEFORE the line `const result = await runAgent({...})`, insert the AgentInstance upsert:

```ts
const agentInstance = await prisma.agentInstance.upsert({
  create: {
    displayName: "Designer",
    mission: "",
    orgId: link.orgId,
    templateSlug: "designer",
  },
  update: {},
  where: { orgId_templateSlug: { orgId: link.orgId, templateSlug: "designer" } },
});
```

Then replace the `runAgent({...})` call with:

```ts
const result = await dispatcher.enqueueAndAwait({
  agentInstance,
  currentContext,
  existingAssets,
  input: {
    audioBytes,
    audioMime: audio?.mimeType,
    imageBytes,
    text: text.length > 0 ? text : undefined,
  },
  newAssets,
  oversizeCount,
  prisma: prisma as PrismaClient,
});
```

The `orgId` field is gone from the call args — the dispatcher reads it from `agentInstance.orgId`.

- [ ] **Step 2: Update handler.test.ts mocks**

Open `apps/api/src/telegram/handler.test.ts`. Find tests that pass a `runAgent` override and replace them with a `dispatcher` override:

Before:

```ts
runAgent: vi.fn().mockResolvedValue({
  /* result */
});
```

After:

```ts
dispatcher: {
  enqueueAndAwait: vi.fn().mockResolvedValue({
    /* result */
  });
}
```

The result-shape stays identical (`{ generatedAssetIds, text, toolCallSummary, usage }`).

Additionally, any handler test's fakePrisma needs to include `agentInstance: { upsert: vi.fn().mockResolvedValue({ id: "ai_test", orgId: <orgId>, templateSlug: "designer", enabledSkillIds: null, mission: "", displayName: "Designer" }) }` so the new upsert call has a return value.

Walk through every handler test that exercises the agent path. For tests that mock the agent's result, also mock the agentInstance upsert. Tests that short-circuit before the agent path (empty text, dedup hit, audio-download failure) don't need the agentInstance mock — but they may need it if they pass through the upsert step. Run the tests after each change; fix any that throw "Cannot read property 'upsert' of undefined".

- [ ] **Step 3: Format + run handler tests in isolation**

```bash
pnpm exec oxfmt apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
pnpm --filter api test handler
```

All handler tests pass.

- [ ] **Step 4: Confirm live bot is healthy**

```bash
curl -s http://localhost:4000/healthz && echo
```

Dev server hot-reloaded; still serving.

- [ ] **Step 5: Full repo gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests still 82 (no count change — Task 8 modifies existing tests, doesn't add new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
git commit -m "refactor(api): handler dispatches via runtime + lazy-creates AgentInstance"
```

---

## Task 9: Delete dead lib/ai.ts

**Files to delete:**

- `apps/api/src/lib/ai.ts`
- `apps/api/src/lib/ai.test.ts`

After Task 8, `lib/ai.ts` is no longer imported anywhere. Confirm and delete.

- [ ] **Step 1: Confirm no imports remain**

```bash
grep -rn "lib/ai" apps/api/src
```

Should print nothing. If anything still imports from `lib/ai`, fix that file FIRST before deletion (probably an oversight in Task 8).

- [ ] **Step 2: Delete the files**

```bash
git rm apps/api/src/lib/ai.ts apps/api/src/lib/ai.test.ts
```

- [ ] **Step 3: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 82 minus however many lived in `lib/ai.test.ts`. The Phase 5b lib/ai.test.ts has 3 tests, so expect 79 total (75 api + 4 db).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(api): remove dead lib/ai.ts (logic moved to agents/runtime.ts)"
```

`git rm` already staged the deletions; no `git add` needed.

---

## Task 10: Live bot smoke test + final gates + finishing

**Files:** none modified

- [ ] **Step 1: Final-gate run**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests 79.

- [ ] **Step 2: Confirm dev server is healthy and AgentInstance was upserted**

```bash
curl -s http://localhost:4000/healthz && echo
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT \"id\", \"orgId\", \"templateSlug\", \"displayName\" FROM \"AgentInstance\";"
```

Initial expected: 0 rows (no one has messaged the bot yet through the new path).

- [ ] **Step 3: Send a real message to @qolmeia_mvp_v0_bot**

Open Telegram, send something like:

```
oi, teste fase 5c runtime + designer
```

Watch the dev server terminal for the `telegram message handled` log line. Note the `toolCallSummary` keys — they should still be `extractSoul`, `generateBrandImage`, `labelBrandAsset`.

- [ ] **Step 4: Confirm AgentInstance was lazy-created**

```bash
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT \"id\", \"orgId\", \"templateSlug\", \"displayName\", \"mission\", \"enabledSkillIds\" FROM \"AgentInstance\";"
```

Expected: 1 row, templateSlug=`designer`, displayName=`Designer`, mission=``, enabledSkillIds=`NULL`.

- [ ] **Step 5: Restore the stashed change**

```bash
git stash list
git stash pop
git status --short
```

webhook.ts should reappear as `M`. If oxfmt drift creates an extra phantom modification (it did in Phase 5b), `git checkout -- apps/api/src/<the-phantom-file>` to discard.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin qolmeia-phase-5c-runtime-and-designer
```

- [ ] **Step 7: Hand off to finishing-a-development-branch**

Phase 5c is complete on the branch with this commit lineage:

1. `chore(api): remove dead knowledge/extract re-export and stale apply.ts comment`
2. `feat(api): add Designer AgentTemplate and templates registry`
3. `feat(api): add syncSkills + syncTemplates with findSkillById + findTemplateBySlug`
4. `feat(api): sync skills + templates at API startup`
5. `feat(api): add AgentDispatcher interface and SerialDispatcher`
6. `feat(api): add agents/runtime.ts with runAgentInstance`
7. `refactor(api): handler dispatches via runtime + lazy-creates AgentInstance`
8. `refactor(api): remove dead lib/ai.ts (logic moved to agents/runtime.ts)`

Use `superpowers:finishing-a-development-branch` to choose merge / PR / hold.

---

## Self-review notes

**Spec coverage (§5 + §6 + §11 phase 5c):**

| Spec requirement                                                             | Implemented in | Verified by                                                              |
| ---------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `agents/templates/` folder with registry + Designer                          | Task 3         | Templates registry tests                                                 |
| `agents/templates/designer.ts` carries the moved AGENT_SYSTEM_TEMPLATE       | Task 3         | Designer template test asserts `{{currentContext}}` placeholder presence |
| `syncTemplates(prisma)` + `syncSkills(prisma)`                               | Task 4         | Unit tests verify upsert call shape                                      |
| Startup wires syncs (Skill before AgentTemplate, M:N safe)                   | Task 5         | Live DB row check                                                        |
| `agents/dispatcher.ts` with `AgentDispatcher` interface + `SerialDispatcher` | Task 6         | Unit tests                                                               |
| `agents/runtime.ts` with `runAgentInstance`                                  | Task 7         | Unit tests for template resolution, skill filtering, step aggregation    |
| Skill filtering via `enabledSkillIds` (null = template default)              | Task 7         | Dedicated test case                                                      |
| `telegram/handler.ts` lazy-creates AgentInstance and dispatches              | Task 8         | Handler test update + live verify                                        |
| `lib/ai.ts` deleted                                                          | Task 9         | grep + file absence                                                      |
| Bot behavior unchanged                                                       | Task 10        | Live Telegram smoke test                                                 |

**Placeholder scan:** No "TBD", "TODO", "implement later", or "appropriate" in step bodies. Every code block is complete.

**Type consistency check:**

- `AgentTemplateDefinition.canDelegateTo: ReadonlyArray<string>` — matches spec; for Phase 5c only `designer` has `[]`.
- `SkillContext` remains `{ orgId, prisma }` — `agentInstanceId` extension deferred to Phase 5d (per the Phase 5b reviewer note).
- `AgentDispatchArgs.input` shape mirrors what the handler currently passes to `runAgent`.
- `AgentRunResult` returned by `runAgentInstance` has the same shape `handler.ts` consumed before (`generatedAssetIds`, `text`, `toolCallSummary`, `usage`).
- Tool key names sent to the model: `extractSoul`, `generateBrandImage`, `labelBrandAsset` — unchanged.

**Known type weakness carried over:** the `as Skill<unknown, unknown>` cast in the skills registry. Phase 5d should replace with a `defineSkill<T>` helper. Phase 5c does not touch this — it would expand the diff.

**Risk for Phase 5d (Controller + delegation):** the runtime hard-codes the search for `generateBrandImage` tool-result asset IDs (line walking `step.content[]`). Phase 5d's Controller will not produce generated images directly — it delegates to specialists. When the delegated specialist's results flow back, the aggregation logic may need to recurse over child action results, not the top-level steps. Flag for Phase 5d's planning.
