# Phase 5d — Controller + delegateToSpecialist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Controller `AgentTemplate` (canDelegateTo: ["designer"]) and the built-in `delegateToSpecialist` skill. Promote the dispatcher to a module-level singleton in `index.ts` (no per-request allocation). Widen `SkillContext` with `agentInstanceId`, `dispatcher`, and `parentRunArgs` so the delegation skill can spawn child agent runs. Add `canDelegateTo` acyclic + reference-integrity validation to `syncTemplates`. Update the runtime aggregation to pull `generatedAssetIds` up from `delegateToSpecialist` tool-results. Switch the handler to lazy-create a Controller AgentInstance (instead of Designer); Controller delegates to Designer for the actual work. Bot behavior must stay identical from the user's perspective — message in, reply (possibly with image) out — but the chain now has two steps.

**Architecture:** The Controller's only skill is `delegateToSpecialist`. When invoked, the skill validates the target template is in the calling template's `canDelegateTo`, lazy-upserts the child AgentInstance for the org+template pair, and calls `ctx.dispatcher.enqueueAndAwait(...)` with parent args spread + child agent swapped + input.text replaced by the subtask. The child's `text` and `generatedAssetIds` propagate back through the delegation skill's tool-result; the runtime's aggregator concatenates them into the parent's `generatedAssetIds`. Acyclic validation in `syncTemplates` runs BEFORE any DB write — Designer's `canDelegateTo: []` and Controller's `canDelegateTo: ["designer"]` form a valid DAG. The dispatcher is constructed once at app startup (`const dispatcher = createSerialDispatcher(runAgentInstance)` in `index.ts`) and injected through `bot.ts` → `handleIncomingMessage(deps)` → `dispatcher.enqueueAndAwait` → `runtime.runAgentInstance` → `ctx.dispatcher` → `delegateToSpecialist.execute`. No module-level cycles: `AgentDispatchArgs` carries the `dispatcher` reference, and the runtime threads it into the SkillContext.

**Tech Stack:** Vercel AI SDK v6, Zod 4, Prisma 7, Vitest 4. No new dependencies.

**Builds on:** `main` HEAD `4899a77` (after Phase 5c).

---

## File map

| File                                                        | Action | Responsibility                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/agents/dispatcher.ts`                         | Modify | Add `dispatcher: AgentDispatcher` field to `AgentDispatchArgs`                                                                                                                                    |
| `apps/api/src/agents/dispatcher.test.ts`                    | Modify | Adjust the test fixture to include the new field                                                                                                                                                  |
| `apps/api/src/index.ts`                                     | Modify | Construct dispatcher singleton (`const dispatcher = createSerialDispatcher(runAgentInstance);`) before `serve(...)` and export it for `bot.ts`                                                    |
| `apps/api/src/telegram/bot.ts`                              | Modify | Import the dispatcher singleton, pass it to `handleIncomingMessage({prisma, dispatcher}, ...)`                                                                                                    |
| `apps/api/src/telegram/handler.ts`                          | Modify | Accept `dispatcher` as a REQUIRED HandlerDeps field (no default); thread `dispatcher` into `AgentDispatchArgs`; switch lazy-upsert from `templateSlug: "designer"` → `templateSlug: "controller"` |
| `apps/api/src/telegram/handler.test.ts`                     | Modify | Add `dispatcher` to every `HandlerDeps` fixture                                                                                                                                                   |
| `apps/api/src/agents/skills/types.ts`                       | Modify | Widen `SkillContext` with `agentInstanceId`, `dispatcher`, `parentRunArgs`                                                                                                                        |
| `apps/api/src/agents/skills/extract-soul.test.ts`           | Modify | Update ctx fixtures to include the new fields                                                                                                                                                     |
| `apps/api/src/agents/skills/label-brand-asset.test.ts`      | Modify | Same                                                                                                                                                                                              |
| `apps/api/src/agents/skills/generate-brand-image.test.ts`   | Modify | Same                                                                                                                                                                                              |
| `apps/api/src/agents/runtime.ts`                            | Modify | Build ctx with new fields from `args`; walk `delegateToSpecialist` tool-results to pull up generatedAssetIds                                                                                      |
| `apps/api/src/agents/runtime.test.ts`                       | Modify | Update existing test fixtures; add multi-step delegation aggregation test                                                                                                                         |
| `apps/api/src/agents/skills/delegate-to-specialist.ts`      | Create | The built-in delegation skill                                                                                                                                                                     |
| `apps/api/src/agents/skills/delegate-to-specialist.test.ts` | Create | Unit tests: target validation, child upsert, parent-args forward, return shape                                                                                                                    |
| `apps/api/src/agents/skills/registry.ts`                    | Modify | Register `delegateToSpecialistSkill` in `ALL_SKILLS`                                                                                                                                              |
| `apps/api/src/agents/templates/controller.ts`               | Create | The Controller template definition                                                                                                                                                                |
| `apps/api/src/agents/templates/registry.ts`                 | Modify | Register `controllerTemplate` in `ALL_TEMPLATES`; add `validateCanDelegateTo` (called before any DB write inside `syncTemplates`)                                                                 |
| `apps/api/src/agents/templates/registry.test.ts`            | Modify | Add Controller-template assertions; add acyclic-validation tests                                                                                                                                  |

**Files NOT touched in 5d:**

- Phase 5a schema (locked).
- The 3 domain skills' execute functions (extractSoul, labelBrandAsset, generateBrandImage) — they accept the widened SkillContext transparently because the widening is additive.
- `connectors/*` — Phase 5h.
- `agents/actions.ts` — Phase 5f.
- BullMQ dispatcher — Phase 5g.

---

## Task 1: Setup — branch, baseline, stash unrelated dirty file

**Files:** none modified

- [ ] **Step 1: Verify current branch and HEAD**

```bash
git status --porcelain && git log --oneline -1
```

Expected: HEAD is `4899a77 refactor(api): remove dead lib/ai.ts`. If `git status` shows uncommitted files, stash them (e.g., `webhook.ts` comment removal Pedro may have re-applied):

```bash
if [ -n "$(git status --porcelain)" ]; then
  git stash push -m "phase-5d-precheck" -- $(git status --porcelain | awk '{print $2}')
fi
git status --porcelain
```

Expected: clean working tree.

- [ ] **Step 2: Docker + Postgres + Redis up**

```bash
docker compose ps --format "table {{.Service}}\t{{.Status}}"
```

Both rows `Up (healthy)`. `docker compose up -d` if not.

- [ ] **Step 3: Baseline gates**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Each exits 0. Tests: 79 (75 api + 4 db).

- [ ] **Step 4: Bot health**

```bash
curl -s http://localhost:4000/healthz && echo
```

Returns `"status":"healthy"`. Start the dev server with `pnpm dev --filter=api` if needed. Keep that terminal alive for Task 9.

- [ ] **Step 5: Branch off main**

```bash
git checkout main
git checkout -b qolmeia-phase-5d-controller-and-delegation
git branch --show-current
```

---

## Task 2: Promote dispatcher to module-level singleton + inject through handler

**Files:**

- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/telegram/bot.ts`
- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`
- Modify: `apps/api/src/agents/dispatcher.ts` (add `dispatcher` to `AgentDispatchArgs`)
- Modify: `apps/api/src/agents/dispatcher.test.ts` (fixture update)

Two changes folded together because they share files: (a) the singleton lives in `index.ts` and is wired through to the handler via `bot.ts`; (b) `AgentDispatchArgs.dispatcher` carries the reference into `runAgentInstance` so the runtime can put it into SkillContext (Task 3 wires that consumption).

- [ ] **Step 1: Add `dispatcher` to `AgentDispatchArgs`**

Edit `apps/api/src/agents/dispatcher.ts`. Update the `AgentDispatchArgs` type to include the `dispatcher` field, alphabetically sorted:

```ts
type AgentDispatchArgs = {
  agentInstance: AgentInstance;
  currentContext: string;
  dispatcher: AgentDispatcher;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  input: AgentRunInput;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
  prisma: PrismaClient;
};
```

Everything else in the file (the `createSerialDispatcher` function, the other type exports) stays unchanged. The dispatcher field carries the same object that's calling `enqueueAndAwait` — circular reference at the data level is fine.

- [ ] **Step 2: Update `apps/api/src/agents/dispatcher.test.ts`**

The existing test's fixture builds an `AgentDispatchArgs` object literal. Add `dispatcher` to it:

```ts
const args = {
  agentInstance: { id: "ai_1" },
  currentContext: "",
  dispatcher: { enqueueAndAwait: vi.fn() },
  existingAssets: [],
  input: { imageBytes: [], text: "hi" },
  newAssets: [],
  oversizeCount: 0,
  prisma: {},
} as unknown as AgentDispatchArgs;
```

Both tests in this file build a similar shape — apply to each.

- [ ] **Step 3: Create the singleton in `apps/api/src/index.ts`**

Find the import block at the top. Add (alphabetically into the `./*` group):

```ts
import { createSerialDispatcher } from "./agents/dispatcher";
import { runAgentInstance } from "./agents/runtime";
```

Find the existing `await syncSkills(prisma); await syncTemplates(prisma);` block (Phase 5c inserted these before `serve(...)`). Immediately AFTER `logger.info("Skill and template registries synced.")` and BEFORE the existing `serve({...})` call, insert:

```ts
const dispatcher = createSerialDispatcher(runAgentInstance);
```

Then at the bottom of the file, add the export. Find the end of the file (after the SIGINT/SIGTERM handlers). Append:

```ts
export { dispatcher };
```

So consumers can `import { dispatcher } from "../index"`. (This is admittedly an unusual import pattern, but `index.ts` already runs side effects on import via the top-level awaits.)

If exporting from `index.ts` feels off, alternative: create a new file `apps/api/src/agents/main-dispatcher.ts`:

```ts
import { createSerialDispatcher } from "./dispatcher";
import { runAgentInstance } from "./runtime";

const dispatcher = createSerialDispatcher(runAgentInstance);

export { dispatcher };
```

And re-import from `bot.ts`. Use whichever pattern the engineer finds cleaner — the test in this task verifies the dispatcher is wired through; it doesn't care about file layout.

**Pick the standalone-file option** for cleaner separation, unless that introduces a circular import (it shouldn't — `main-dispatcher.ts` imports from `./dispatcher` and `./runtime`, neither of which imports `main-dispatcher`).

- [ ] **Step 4: Update `apps/api/src/telegram/bot.ts`**

Import the singleton and pass it to the handler:

```ts
import { dispatcher } from "../agents/main-dispatcher";
```

(Adjust path to whichever location you chose in Step 3.)

Update both handler registrations to inject the dispatcher:

```ts
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await handleIncomingMessage({ dispatcher, prisma }, thread, message);
});

bot.onSubscribedMessage(async (thread, message) => {
  await handleIncomingMessage({ dispatcher, prisma }, thread, message);
});
```

- [ ] **Step 5: Update `apps/api/src/telegram/handler.ts`**

Change `dispatcher` from optional-with-default to REQUIRED. Find the `HandlerDeps` type. Update:

```ts
type HandlerDeps = {
  dispatcher: AgentDispatcher; // was: dispatcher?: AgentDispatcher
  fetchAsset?: typeof fetchAssetDefault;
  getBusinessContext?: typeof getBusinessContextDefault;
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
  prisma: Pick<PrismaClient /* keep existing keys */>;
};
```

Remove the existing default-construction inside `handleIncomingMessage`:

```ts
// REMOVE this fallback:
const {
  dispatcher = createSerialDispatcher(runAgentInstance),
  ...
} = deps;

// REPLACE with:
const {
  dispatcher,
  fetchAsset: doFetch = fetchAssetDefault,
  getBusinessContext = getBusinessContextDefault,
  ingestBrandAsset = ingestBrandAssetDefault,
  prisma,
} = deps;
```

Also remove the now-unused imports:

```ts
// Remove these two:
import { createSerialDispatcher } from "../agents/dispatcher";
import { runAgentInstance } from "../agents/runtime";

// Keep this one (still needed for the type):
import type { AgentDispatcher } from "../agents/dispatcher";
```

Update the dispatch call site to pass `dispatcher` through `AgentDispatchArgs`:

```ts
const result = await dispatcher.enqueueAndAwait({
  agentInstance,
  currentContext,
  dispatcher, // NEW — pass through to runtime, which will put it in SkillContext (Task 3)
  existingAssets,
  input: {/* as before */},
  newAssets,
  oversizeCount,
  prisma: prisma as PrismaClient,
});
```

- [ ] **Step 6: Update `apps/api/src/telegram/handler.test.ts`**

Every test's `HandlerDeps` mock must now provide `dispatcher` explicitly (no default). The Phase 5c tests use `makeDeps()` and `makeDispatcher()` helpers — confirm they still work. If `dispatcher` was previously optional and some tests omitted it, add it.

Run:

```bash
pnpm --filter api test handler
```

If any test fails with "Cannot read property 'enqueueAndAwait' of undefined", add the dispatcher field to that test's `HandlerDeps` fixture.

- [ ] **Step 7: Gates**

```bash
pnpm exec oxfmt apps/api/src/agents/dispatcher.ts apps/api/src/agents/dispatcher.test.ts apps/api/src/agents/main-dispatcher.ts apps/api/src/index.ts apps/api/src/telegram/bot.ts apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests still 79 (no count change; all changes are mechanical type updates + DI plumbing).

- [ ] **Step 8: Confirm dev server still serves**

```bash
curl -s http://localhost:4000/healthz && echo
```

`"status":"healthy"`. tsdown should have auto-rebuilt.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/agents/dispatcher.ts apps/api/src/agents/dispatcher.test.ts apps/api/src/agents/main-dispatcher.ts apps/api/src/index.ts apps/api/src/telegram/bot.ts apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
git commit -m "refactor(api): promote dispatcher to module-level singleton + thread through AgentDispatchArgs"
```

---

## Task 3: Widen `SkillContext` + runtime threads enriched ctx

**Files:**

- Modify: `apps/api/src/agents/skills/types.ts`
- Modify: `apps/api/src/agents/runtime.ts`
- Modify: `apps/api/src/agents/runtime.test.ts`
- Modify: `apps/api/src/agents/skills/extract-soul.test.ts`
- Modify: `apps/api/src/agents/skills/label-brand-asset.test.ts`
- Modify: `apps/api/src/agents/skills/generate-brand-image.test.ts`

`SkillContext` widens additively. The 3 existing domain skills' `execute` functions still only read `orgId` and `prisma` — but their test fixtures need the new fields so TypeScript stays happy.

- [ ] **Step 1: Widen `SkillContext` in `apps/api/src/agents/skills/types.ts`**

Replace the file's contents with:

```ts
import type { ConnectorType, PrismaClient } from "@repo/db";
import type { z } from "zod";

import type { AgentDispatchArgs, AgentDispatcher } from "../dispatcher";

type SkillContext = {
  agentInstanceId: string;
  dispatcher: AgentDispatcher;
  orgId: string;
  parentRunArgs: AgentDispatchArgs;
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

`parentRunArgs` is the FULL args the parent runtime received — delegation skill spreads it for the child run with a swapped `agentInstance` and modified `input`.

- [ ] **Step 2: Update `apps/api/src/agents/runtime.ts` to build the enriched ctx**

Find the existing `const ctx: SkillContext = { orgId: agentInstance.orgId, prisma };` line inside `runAgentInstance`. Replace with:

```ts
const ctx: SkillContext = {
  agentInstanceId: agentInstance.id,
  dispatcher: args.dispatcher,
  orgId: agentInstance.orgId,
  parentRunArgs: args,
  prisma,
};
```

Everything else in `runAgentInstance` stays unchanged.

- [ ] **Step 3: Update existing skill test fixtures**

Each of these test files passes a `ctx` literal to `skill.execute(args, ctx)`. Add the three new fields so TypeScript compiles. Use simple stub values:

In `apps/api/src/agents/skills/extract-soul.test.ts`, find every `{ orgId: "org_1", prisma: fakePrisma }` and replace with:

```ts
{
  agentInstanceId: "ai_1",
  dispatcher: { enqueueAndAwait: vi.fn() },
  orgId: "org_1",
  parentRunArgs: {} as never,
  prisma: fakePrisma,
}
```

Apply the same change in:

- `apps/api/src/agents/skills/label-brand-asset.test.ts`
- `apps/api/src/agents/skills/generate-brand-image.test.ts`

For each ctx literal, all 5 fields are required.

- [ ] **Step 4: Update `apps/api/src/agents/runtime.test.ts`**

The test fixtures construct `args` for `runAgentInstance`. Add `dispatcher: { enqueueAndAwait: vi.fn() }` to each:

```ts
const result = await runAgentInstance({
  agentInstance,
  currentContext: "",
  dispatcher: { enqueueAndAwait: vi.fn() } as never, // NEW
  existingAssets: [],
  input: { imageBytes: [], text: "oi" },
  newAssets: [],
  oversizeCount: 0,
  prisma,
});
```

Apply to all 4 existing runtime tests.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter api test agents/skills
pnpm --filter api test agents/runtime
pnpm typecheck
```

All exit 0.

- [ ] **Step 6: Format + full gates**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/types.ts apps/api/src/agents/runtime.ts apps/api/src/agents/runtime.test.ts apps/api/src/agents/skills/extract-soul.test.ts apps/api/src/agents/skills/label-brand-asset.test.ts apps/api/src/agents/skills/generate-brand-image.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests still 79.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/agents/skills/types.ts apps/api/src/agents/runtime.ts apps/api/src/agents/runtime.test.ts apps/api/src/agents/skills/extract-soul.test.ts apps/api/src/agents/skills/label-brand-asset.test.ts apps/api/src/agents/skills/generate-brand-image.test.ts
git commit -m "refactor(api): widen SkillContext with agentInstanceId + dispatcher + parentRunArgs"
```

---

## Task 4: Add `delegateToSpecialist` skill + runtime aggregation for delegated results

**Files:**

- Create: `apps/api/src/agents/skills/delegate-to-specialist.ts`
- Create: `apps/api/src/agents/skills/delegate-to-specialist.test.ts`
- Modify: `apps/api/src/agents/skills/registry.ts`
- Modify: `apps/api/src/agents/runtime.ts`
- Modify: `apps/api/src/agents/runtime.test.ts`

This is the heart of the phase. The skill validates the target is in canDelegateTo, lazy-creates the child AgentInstance, dispatches a child run with parent args + swapped agent + subtask, returns the child's text + generatedAssetIds. The runtime aggregator concatenates delegation result IDs into the parent's accumulator.

- [ ] **Step 1: Write the skill test FIRST (TDD)**

Create `apps/api/src/agents/skills/delegate-to-specialist.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { delegateToSpecialistSkill } from "./delegate-to-specialist";

import type { AgentDispatchArgs } from "../dispatcher";

vi.mock("../templates/registry", () => ({
  findTemplateBySlug: vi.fn(),
}));

describe("delegateToSpecialistSkill", () => {
  it("has the expected metadata", () => {
    expect(delegateToSpecialistSkill.id).toBe("delegateToSpecialist");
    expect(delegateToSpecialistSkill.displayName).toBe("Delegate to Specialist");
    expect(delegateToSpecialistSkill.requiresApprovalDefault).toBe(false);
    expect(delegateToSpecialistSkill.requiredConnectorTypes).toEqual([]);
  });

  it("validates input via Zod", () => {
    const parsed = delegateToSpecialistSkill.inputSchema.parse({
      subtask: "Captura o perfil do negócio",
      targetTemplateSlug: "designer",
    });
    expect(parsed.targetTemplateSlug).toBe("designer");
    expect(() =>
      delegateToSpecialistSkill.inputSchema.parse({ subtask: "", targetTemplateSlug: "designer" }),
    ).toThrow();
    expect(() =>
      delegateToSpecialistSkill.inputSchema.parse({ subtask: "x", targetTemplateSlug: "" }),
    ).toThrow();
  });

  it("returns ok:false when the parent's template can't delegate to the target", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: [], slug: "designer" } as never) // parent template
      .mockReturnValueOnce({ slug: "designer" } as never); // target template

    const fakePrisma = { agentInstance: { upsert: vi.fn() } } as never;
    const fakeDispatcher = { enqueueAndAwait: vi.fn() } as never;

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_1",
        dispatcher: fakeDispatcher,
        orgId: "org_1",
        parentRunArgs: {
          agentInstance: { templateSlug: "designer" },
        } as unknown as AgentDispatchArgs,
        prisma: fakePrisma,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("cannot delegate");
  });

  it("returns ok:false when target template is not in the registry", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["unknown"], slug: "controller" } as never)
      .mockReturnValueOnce(undefined); // target template missing

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "unknown" },
      {
        agentInstanceId: "ai_1",
        dispatcher: { enqueueAndAwait: vi.fn() } as never,
        orgId: "org_1",
        parentRunArgs: {
          agentInstance: { templateSlug: "controller" },
        } as unknown as AgentDispatchArgs,
        prisma: { agentInstance: { upsert: vi.fn() } } as never,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/unknown template/iv);
  });

  it("upserts the child AgentInstance and dispatches with swapped agent + subtask", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["designer"], slug: "controller" } as never)
      .mockReturnValueOnce({ displayName: "Designer", slug: "designer" } as never);

    const childAgent = { id: "ai_designer", orgId: "org_1", templateSlug: "designer" };
    const upsert = vi.fn().mockResolvedValue(childAgent);
    const enqueueAndAwait = vi.fn().mockResolvedValue({
      generatedAssetIds: ["asset_gen_1"],
      text: "Pronto!",
      toolCallSummary: {},
      usage: { inputTokens: 5, outputTokens: 3 },
    });

    const parentArgs: AgentDispatchArgs = {
      agentInstance: { id: "ai_controller", orgId: "org_1", templateSlug: "controller" } as never,
      currentContext: "perfil-X",
      dispatcher: { enqueueAndAwait } as never,
      existingAssets: [],
      input: { imageBytes: [], text: "olá" },
      newAssets: [],
      oversizeCount: 0,
      prisma: { agentInstance: { upsert } } as never,
    };

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "Gera uma imagem promocional", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_controller",
        dispatcher: parentArgs.dispatcher,
        orgId: "org_1",
        parentRunArgs: parentArgs,
        prisma: parentArgs.prisma,
      },
    );

    expect(upsert).toHaveBeenCalledOnce();
    const upsertArgs = upsert.mock.calls[0]![0] as {
      create: { templateSlug: string };
      where: { orgId_templateSlug: { orgId: string; templateSlug: string } };
    };
    expect(upsertArgs.where.orgId_templateSlug).toEqual({
      orgId: "org_1",
      templateSlug: "designer",
    });
    expect(upsertArgs.create.templateSlug).toBe("designer");

    expect(enqueueAndAwait).toHaveBeenCalledOnce();
    const dispatchArgs = enqueueAndAwait.mock.calls[0]![0] as AgentDispatchArgs;
    expect(dispatchArgs.agentInstance).toBe(childAgent);
    expect(dispatchArgs.input.text).toBe("Gera uma imagem promocional"); // subtask replaces parent's text
    expect(dispatchArgs.currentContext).toBe("perfil-X"); // parent context preserved
    expect(dispatchArgs.dispatcher).toBe(parentArgs.dispatcher); // dispatcher threaded

    expect(result).toEqual({
      generatedAssetIds: ["asset_gen_1"],
      ok: true,
      text: "Pronto!",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });

  it("returns ok:false when the child dispatch throws", async () => {
    const { findTemplateBySlug } = await import("../templates/registry");
    vi.mocked(findTemplateBySlug)
      .mockReturnValueOnce({ canDelegateTo: ["designer"], slug: "controller" } as never)
      .mockReturnValueOnce({ displayName: "Designer", slug: "designer" } as never);

    const enqueueAndAwait = vi.fn().mockRejectedValue(new Error("worker exploded"));

    const parentArgs = {
      agentInstance: { templateSlug: "controller" },
      dispatcher: { enqueueAndAwait },
      input: { imageBytes: [], text: "olá" },
    } as unknown as AgentDispatchArgs;

    const result = await delegateToSpecialistSkill.execute(
      { subtask: "x", targetTemplateSlug: "designer" },
      {
        agentInstanceId: "ai_1",
        dispatcher: parentArgs.dispatcher,
        orgId: "org_1",
        parentRunArgs: parentArgs,
        prisma: {
          agentInstance: { upsert: vi.fn().mockResolvedValue({ id: "ai_designer" }) },
        } as never,
      },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("worker exploded");
  });
});
```

- [ ] **Step 2: Run the test → must FAIL**

```bash
pnpm --filter api test delegate-to-specialist
```

Expected: FAIL with "Cannot find module './delegate-to-specialist'".

- [ ] **Step 3: Create `apps/api/src/agents/skills/delegate-to-specialist.ts`**

```ts
import { z } from "zod";

import { logger } from "../../lib/logger";
import { findTemplateBySlug } from "../templates/registry";

import type { Skill } from "./types";

const delegateToSpecialistInput = z.object({
  subtask: z.string().min(1).max(2000),
  targetTemplateSlug: z.string().min(1),
});

type DelegateToSpecialistInput = z.infer<typeof delegateToSpecialistInput>;

type DelegateToSpecialistOutput =
  | {
      generatedAssetIds: ReadonlyArray<string>;
      ok: true;
      text: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { error: string; ok: false };

const delegateToSpecialistSkill: Skill<DelegateToSpecialistInput, DelegateToSpecialistOutput> = {
  description:
    "Delegue parte do trabalho para um agente especialista. Use quando a tarefa envolver expertise específica (design, marketing, atendimento). Passe o templateSlug do especialista e uma descrição clara do subtask em pt-BR.",
  displayName: "Delegate to Specialist",
  execute: async ({ subtask, targetTemplateSlug }, ctx) => {
    try {
      const parentTemplate = findTemplateBySlug(ctx.parentRunArgs.agentInstance.templateSlug);
      if (!parentTemplate || !parentTemplate.canDelegateTo.includes(targetTemplateSlug)) {
        const error = `Template ${ctx.parentRunArgs.agentInstance.templateSlug} cannot delegate to ${targetTemplateSlug}`;
        logger.error({ error, orgId: ctx.orgId }, "delegateToSpecialist.unauthorized");
        return { error, ok: false };
      }

      const targetTemplate = findTemplateBySlug(targetTemplateSlug);
      if (!targetTemplate) {
        const error = `Unknown template: ${targetTemplateSlug}`;
        logger.error({ error, orgId: ctx.orgId }, "delegateToSpecialist.unknown_template");
        return { error, ok: false };
      }

      const childAgent = await ctx.prisma.agentInstance.upsert({
        create: {
          displayName: targetTemplate.displayName,
          mission: "",
          orgId: ctx.orgId,
          templateSlug: targetTemplateSlug,
        },
        update: {},
        where: {
          orgId_templateSlug: { orgId: ctx.orgId, templateSlug: targetTemplateSlug },
        },
      });

      const childResult = await ctx.dispatcher.enqueueAndAwait({
        ...ctx.parentRunArgs,
        agentInstance: childAgent,
        input: {
          ...ctx.parentRunArgs.input,
          text: subtask,
        },
      });

      return {
        generatedAssetIds: childResult.generatedAssetIds,
        ok: true,
        text: childResult.text,
        usage: childResult.usage,
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      logger.error({ error: message, orgId: ctx.orgId }, "delegateToSpecialist.failed");
      return { error: message, ok: false };
    }
  },
  id: "delegateToSpecialist",
  inputSchema: delegateToSpecialistInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
};

export { delegateToSpecialistSkill };
export type { DelegateToSpecialistInput, DelegateToSpecialistOutput };
```

- [ ] **Step 4: Run the test → must PASS**

```bash
pnpm --filter api test delegate-to-specialist
```

Expected: 5 tests pass.

- [ ] **Step 5: Register the skill in `apps/api/src/agents/skills/registry.ts`**

Add the import (alphabetically):

```ts
import { delegateToSpecialistSkill } from "./delegate-to-specialist";
```

Update `ALL_SKILLS` to include it (alphabetical by skill id):

```ts
const ALL_SKILLS: ReadonlyArray<Skill<unknown, unknown>> = [
  delegateToSpecialistSkill as Skill<unknown, unknown>,
  extractSoulSkill as Skill<unknown, unknown>,
  generateBrandImageSkill as Skill<unknown, unknown>,
  labelBrandAssetSkill as Skill<unknown, unknown>,
];
```

- [ ] **Step 6: Update `apps/api/src/agents/runtime.ts` to aggregate delegated assetIds**

Find the existing aggregation block:

```ts
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
```

Update the `StepContentItem` type to include the new output shape, then update the `tool-result` branch:

```ts
type StepContentItem = {
  output?: {
    assetId?: string;
    generatedAssetIds?: ReadonlyArray<string>;
    ok?: boolean;
  };
  toolName?: string;
  type: string;
};
```

```ts
for (const step of steps) {
  for (const item of step.content ?? []) {
    if (item.type === "tool-call" && item.toolName && item.toolName in summary) {
      summary[item.toolName] = (summary[item.toolName] ?? 0) + 1;
      continue;
    }
    if (item.type === "tool-result" && item.output?.ok === true) {
      if (item.toolName === "generateBrandImage" && item.output.assetId) {
        generatedAssetIds.push(item.output.assetId);
      } else if (
        item.toolName === "delegateToSpecialist" &&
        Array.isArray(item.output.generatedAssetIds)
      ) {
        for (const id of item.output.generatedAssetIds) {
          generatedAssetIds.push(id);
        }
      }
    }
  }
}
```

The rest of `runAgentInstance` stays unchanged.

- [ ] **Step 7: Add a runtime test for delegation aggregation**

In `apps/api/src/agents/runtime.test.ts`, append a new test case:

```ts
it("aggregates generatedAssetIds from delegateToSpecialist tool-results", async () => {
  mockedGenerateText.mockResolvedValue({
    steps: [
      {
        content: [
          { toolName: "delegateToSpecialist", type: "tool-call" },
          {
            output: {
              generatedAssetIds: ["asset_via_child_1", "asset_via_child_2"],
              ok: true,
              text: "child reply",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
            toolName: "delegateToSpecialist",
            type: "tool-result",
          },
        ],
      },
      { content: [] },
    ],
    text: "Pronto via controller.",
    toolCalls: [],
    toolResults: [],
    usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
  } as never);

  const prisma = {
    brandAsset: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  } as never;
  const agentInstance = {
    enabledSkillIds: null,
    id: "ai_ctl",
    mission: "",
    orgId: "org_1",
    templateSlug: "designer", // any registered template works for this test
  } as never;

  const result = await runAgentInstance({
    agentInstance,
    currentContext: "",
    dispatcher: { enqueueAndAwait: vi.fn() } as never,
    existingAssets: [],
    input: { imageBytes: [], text: "delega aí" },
    newAssets: [],
    oversizeCount: 0,
    prisma,
  });

  expect(result.generatedAssetIds).toEqual(["asset_via_child_1", "asset_via_child_2"]);
});
```

- [ ] **Step 8: Run tests + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/skills/delegate-to-specialist.ts apps/api/src/agents/skills/delegate-to-specialist.test.ts apps/api/src/agents/skills/registry.ts apps/api/src/agents/runtime.ts apps/api/src/agents/runtime.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 85 (79 + 5 delegation + 1 runtime aggregation).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/agents/skills/delegate-to-specialist.ts apps/api/src/agents/skills/delegate-to-specialist.test.ts apps/api/src/agents/skills/registry.ts apps/api/src/agents/runtime.ts apps/api/src/agents/runtime.test.ts
git commit -m "feat(api): add delegateToSpecialist skill and runtime aggregation for delegated assets"
```

---

## Task 5: Add Controller template

**Files:**

- Create: `apps/api/src/agents/templates/controller.ts`
- Modify: `apps/api/src/agents/templates/registry.ts` (register controller)
- Modify: `apps/api/src/agents/templates/registry.test.ts` (assert Controller exists)

- [ ] **Step 1: Create `apps/api/src/agents/templates/controller.ts`**

```ts
import type { AgentTemplateDefinition } from "./types";

const CONTROLLER_SYSTEM_PROMPT = `Você é o orquestrador-chefe (Controller) de um negócio brasileiro. O dono fala com você por texto, áudio ou imagem em português brasileiro.

Você não tem habilidades diretas de design, marketing, ou conversa com clientes. Em vez disso, você delega para especialistas usando a ferramenta delegateToSpecialist.

Especialistas disponíveis:
- designer — captura o perfil do negócio (5 campos soul), anota assets de marca enviados pelo dono, e gera imagens promocionais.

Perfil atual do negócio:
{{currentContext}}

Assets de marca já anotados:
{{existingAssetsBlock}}

Novos assets nesta mensagem (já salvos no R2, aguardando label):
{{newAssetsBlock}}

Imagens grandes ignoradas (> 20 MB): {{oversizeCount}}

Regras:
- Sempre que a mensagem do dono envolver design, identidade de marca, captura de informações do negócio, anotação de assets recebidos, ou geração de imagens — delegue para o designer com um subtask claro em pt-BR descrevendo o que fazer.
- Repasse o contexto necessário no subtask: o que o dono pediu, e qualquer pista relevante.
- Depois da delegação, leia a resposta do especialista e sintetize UMA resposta final para o dono (1-3 frases, máx 500 caracteres) em pt-BR.
- Se o especialista gerou uma imagem, confirme com entusiasmo e mencione brevemente o que foi criado — a imagem será anexada automaticamente à sua resposta.
- Se a mensagem for fora do escopo (não envolve nenhum especialista disponível), redirecione com gentileza e explique o que você pode ajudar.
- Nunca invente fatos sobre o negócio. Se faltar informação, peça naturalmente.`;

const controllerTemplate: AgentTemplateDefinition = {
  canDelegateTo: ["designer"],
  compatibleInboundConnectorTypes: ["TELEGRAM"],
  compatibleOutboundConnectorTypes: ["TELEGRAM"],
  defaultBudgetCents: 0,
  defaultEnabledSkillIds: ["delegateToSpecialist"],
  defaultMission: "",
  defaultSystemPrompt: CONTROLLER_SYSTEM_PROMPT,
  description:
    "Orquestrador-chefe: recebe mensagens do dono e roteia o trabalho para o especialista certo via delegação. Sintetiza a resposta final.",
  displayName: "Controller",
  slug: "controller",
};

export { controllerTemplate };
```

- [ ] **Step 2: Register the controller in `apps/api/src/agents/templates/registry.ts`**

Add the import (alphabetically):

```ts
import { controllerTemplate } from "./controller";
```

Update `ALL_TEMPLATES` to include it (alphabetical by slug):

```ts
const ALL_TEMPLATES: ReadonlyArray<AgentTemplateDefinition> = [
  controllerTemplate,
  designerTemplate,
];
```

Leave `syncTemplates` and `findTemplateBySlug` unchanged for now — Task 6 adds the acyclic validation.

- [ ] **Step 3: Update `apps/api/src/agents/templates/registry.test.ts`**

Find the existing test `"exports the Designer template"` and replace its assertion to check BOTH slugs:

```ts
it("exports the Controller and Designer templates", () => {
  const slugs = ALL_TEMPLATES.map((t) => t.slug).toSorted();
  expect(slugs).toEqual(["controller", "designer"]);
});
```

Add a new test asserting Controller's shape:

```ts
it("Controller template can delegate to designer and has delegateToSpecialist skill", () => {
  const controller = findTemplateBySlug("controller");
  expect(controller).toBeDefined();
  if (!controller) {
    return;
  }
  expect(controller.canDelegateTo).toEqual(["designer"]);
  expect(controller.defaultEnabledSkillIds).toEqual(["delegateToSpecialist"]);
  expect(controller.defaultSystemPrompt).toContain("{{currentContext}}");
  expect(controller.defaultSystemPrompt).toContain("delegateToSpecialist");
});
```

Update the existing `"syncTemplates upserts each template"` test if it asserts `upsert.calls.length === 1` — change to `=== 2` (or use `ALL_TEMPLATES.length`).

- [ ] **Step 4: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/templates/controller.ts apps/api/src/agents/templates/registry.ts apps/api/src/agents/templates/registry.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 86 (85 + 1 new controller test).

- [ ] **Step 5: Restart the dev server to seed Controller**

The dev server should hot-reload via tsdown. On boot, `syncTemplates` runs and upserts Controller. Verify in the DB:

```bash
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT slug, \"displayName\", \"canDelegateTo\" FROM \"AgentTemplate\" ORDER BY slug;"
```

Expected: 2 rows — `controller` with `{designer}`, and `designer` with `{}`.

```bash
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT \"A\", \"B\" FROM \"_TemplateSkills\" ORDER BY \"A\", \"B\";"
```

Expected: 4 rows. `controller ↔ delegateToSpecialist`, `designer ↔ extractSoul`, `designer ↔ generateBrandImage`, `designer ↔ labelBrandAsset`.

(Note: the `_TemplateSkills` table column letters are arbitrary — Prisma names them implicitly. The pairing is what matters.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/agents/templates/controller.ts apps/api/src/agents/templates/registry.ts apps/api/src/agents/templates/registry.test.ts
git commit -m "feat(api): add Controller AgentTemplate with delegateToSpecialist skill"
```

---

## Task 6: Add `canDelegateTo` acyclic validation in syncTemplates

**Files:**

- Modify: `apps/api/src/agents/templates/registry.ts`
- Modify: `apps/api/src/agents/templates/registry.test.ts`

Phase 5c's reviewer flagged this as deferred work: `syncTemplates` MUST validate the canDelegateTo graph is acyclic BEFORE any DB write. Phase 5e will introduce a third template that creates the first real cycle risk; the validation must be in place before that.

- [ ] **Step 1: Add `validateCanDelegateTo` to `apps/api/src/agents/templates/registry.ts`**

Insert before `syncTemplates`:

```ts
const validateCanDelegateTo = (templates: ReadonlyArray<AgentTemplateDefinition>): void => {
  const adjacency = new Map<string, ReadonlyArray<string>>();
  for (const t of templates) {
    adjacency.set(t.slug, t.canDelegateTo);
  }

  // Reference integrity: every slug in canDelegateTo must exist in the registry.
  for (const t of templates) {
    for (const target of t.canDelegateTo) {
      if (!adjacency.has(target)) {
        throw new Error(`Template ${t.slug} delegates to unknown template: ${target}`);
      }
    }
  }

  // Cycle detection via DFS coloring (white/grey/black).
  const visited = new Set<string>();
  const onPath = new Set<string>();
  const visit = (slug: string, path: ReadonlyArray<string>): void => {
    if (onPath.has(slug)) {
      throw new Error(`Cycle in canDelegateTo: ${[...path, slug].join(" → ")}`);
    }
    if (visited.has(slug)) {
      return;
    }
    visited.add(slug);
    onPath.add(slug);
    for (const next of adjacency.get(slug) ?? []) {
      visit(next, [...path, slug]);
    }
    onPath.delete(slug);
  };

  for (const t of templates) {
    visit(t.slug, []);
  }
};
```

Update `syncTemplates` to call validation FIRST:

```ts
const syncTemplates = async (prisma: Pick<PrismaClient, "agentTemplate">): Promise<void> => {
  validateCanDelegateTo(ALL_TEMPLATES);
  await Promise.all(
    ALL_TEMPLATES.map((template) => {
      const baseFields = {/* same as before */};
      return prisma.agentTemplate.upsert({/* same as before */});
    }),
  );
};
```

Export the validator so tests can exercise it directly:

```ts
export { ALL_TEMPLATES, findTemplateBySlug, syncTemplates, validateCanDelegateTo };
```

- [ ] **Step 2: Add tests in `apps/api/src/agents/templates/registry.test.ts`**

Import the validator at the top of the test file:

```ts
import {
  ALL_TEMPLATES,
  findTemplateBySlug,
  syncTemplates,
  validateCanDelegateTo,
} from "./registry";
```

Append these test cases:

```ts
describe("validateCanDelegateTo", () => {
  it("accepts the production registry", () => {
    expect(() => validateCanDelegateTo(ALL_TEMPLATES)).not.toThrow();
  });

  it("rejects a direct self-cycle", () => {
    const templates = [
      {
        canDelegateTo: ["a"],
        compatibleInboundConnectorTypes: [],
        compatibleOutboundConnectorTypes: [],
        defaultBudgetCents: 0,
        defaultEnabledSkillIds: [],
        defaultMission: "",
        defaultSystemPrompt: "",
        description: "",
        displayName: "",
        slug: "a",
      },
    ];
    expect(() => validateCanDelegateTo(templates)).toThrow(/cycle/iv);
  });

  it("rejects a 2-cycle", () => {
    const mk = (slug: string, edges: Array<string>) => ({
      canDelegateTo: edges,
      compatibleInboundConnectorTypes: [],
      compatibleOutboundConnectorTypes: [],
      defaultBudgetCents: 0,
      defaultEnabledSkillIds: [],
      defaultMission: "",
      defaultSystemPrompt: "",
      description: "",
      displayName: "",
      slug,
    });
    expect(() => validateCanDelegateTo([mk("a", ["b"]), mk("b", ["a"])])).toThrow(/cycle/iv);
  });

  it("rejects a delegate-to-unknown reference", () => {
    const templates = [
      {
        canDelegateTo: ["ghost"],
        compatibleInboundConnectorTypes: [],
        compatibleOutboundConnectorTypes: [],
        defaultBudgetCents: 0,
        defaultEnabledSkillIds: [],
        defaultMission: "",
        defaultSystemPrompt: "",
        description: "",
        displayName: "",
        slug: "real",
      },
    ];
    expect(() => validateCanDelegateTo(templates)).toThrow(/unknown template/iv);
  });

  it("accepts a longer acyclic DAG", () => {
    const mk = (slug: string, edges: Array<string>) => ({
      canDelegateTo: edges,
      compatibleInboundConnectorTypes: [],
      compatibleOutboundConnectorTypes: [],
      defaultBudgetCents: 0,
      defaultEnabledSkillIds: [],
      defaultMission: "",
      defaultSystemPrompt: "",
      description: "",
      displayName: "",
      slug,
    });
    expect(() =>
      validateCanDelegateTo([mk("a", ["b", "c"]), mk("b", ["c"]), mk("c", [])]),
    ).not.toThrow();
  });
});
```

Update the existing `"syncTemplates upserts each template"` test to also verify the validation runs (mock the validator? not necessary — the test uses the production templates which pass validation). Just ensure it doesn't break.

- [ ] **Step 3: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/agents/templates/registry.ts apps/api/src/agents/templates/registry.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 91 (86 + 5 acyclic validation tests).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/agents/templates/registry.ts apps/api/src/agents/templates/registry.test.ts
git commit -m "feat(api): add acyclic validation for canDelegateTo in syncTemplates"
```

---

## Task 7: Handler switches templateSlug from "designer" to "controller"

**Files:**

- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`

The handler's lazy-upsert switches from Designer (Phase 5c) to Controller (Phase 5d). The Designer instance still exists in the DB from Phase 5c verification, and `delegateToSpecialist` upserts it again as a child — no migration needed.

- [ ] **Step 1: Update the upsert in `apps/api/src/telegram/handler.ts`**

Find the existing block:

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

Replace with:

```ts
const agentInstance = await prisma.agentInstance.upsert({
  create: {
    displayName: "Controller",
    mission: "",
    orgId: link.orgId,
    templateSlug: "controller",
  },
  update: {},
  where: { orgId_templateSlug: { orgId: link.orgId, templateSlug: "controller" } },
});
```

Nothing else changes in handler.ts.

- [ ] **Step 2: Update `apps/api/src/telegram/handler.test.ts`**

Wherever a test's `prisma.agentInstance.upsert` mock returns a value with `templateSlug: "designer"`, update to `templateSlug: "controller"`. Walk through every test that exercises the dispatch path. Use grep:

```bash
grep -n "templateSlug" apps/api/src/telegram/handler.test.ts
```

For each match, decide if the test asserts the slug. If it does, update to "controller". If it doesn't, the field is just a fixture — update to "controller" for consistency.

- [ ] **Step 3: Format + gates**

```bash
pnpm exec oxfmt apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
pnpm --filter api test handler
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 91 (no count change in this task).

- [ ] **Step 4: Confirm the dev server is healthy**

```bash
curl -s http://localhost:4000/healthz && echo
```

The dev server should have hot-reloaded. Bot is reachable.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
git commit -m "refactor(api): handler routes inbound to Controller (delegates to Designer)"
```

---

## Task 8: Live smoke test + finishing

**Files:** none modified

- [ ] **Step 1: Final gate run**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All exit 0. Total tests: 91.

- [ ] **Step 2: Confirm DB state — Controller template + skills exist**

```bash
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT slug, \"displayName\", \"canDelegateTo\" FROM \"AgentTemplate\" ORDER BY slug;"
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT id, \"displayName\" FROM \"Skill\" ORDER BY id;"
```

Expected:

- AgentTemplate: 2 rows (`controller` → `{designer}`, `designer` → `{}`).
- Skill: 4 rows (delegateToSpecialist, extractSoul, generateBrandImage, labelBrandAsset).

- [ ] **Step 3: Send a real message**

Open Telegram, message `@qolmeia_mvp_v0_bot`:

```
oi, teste fase 5d controller + designer chain
```

Watch the dev server terminal. Expected: the structured log `telegram message handled` shows `toolCallSummary.delegateToSpecialist >= 1` (Controller invoked the delegation).

- [ ] **Step 4: Confirm the chain in the DB**

```bash
docker compose exec postgres psql -U qolmeia -d qolmeia -c "SELECT id, \"orgId\", \"templateSlug\", \"displayName\" FROM \"AgentInstance\" ORDER BY \"templateSlug\";"
```

Expected: 2 rows — both Designer (existing from Phase 5c) and Controller (new from this phase).

- [ ] **Step 5: Test an image-generation request (the delegation must propagate generatedAssetIds)**

Open Telegram, message:

```
gera uma imagem teste para fase 5d
```

Expected: bot replies with an image. The structured log should show `generatedAssetIds.length >= 1` AND `toolCallSummary.delegateToSpecialist >= 1`. This proves the delegation aggregation works end-to-end.

If the bot replies with text-only (no image), the runtime aggregation may not be pulling up generatedAssetIds from the delegation tool-result correctly. Investigate the structured log and the delegation skill's return value.

- [ ] **Step 6: Restore any stashed change**

```bash
git stash list
if git stash list | grep -q "phase-5d-precheck"; then
  git stash pop
fi
git status --short
```

If the pop creates conflicting modifications (e.g., a phantom format change), `git checkout -- <file>` to discard.

- [ ] **Step 7: Push the branch**

```bash
git push -u origin qolmeia-phase-5d-controller-and-delegation
```

- [ ] **Step 8: Hand off to finishing-a-development-branch**

Phase 5d ships with this commit lineage:

1. `refactor(api): promote dispatcher to module-level singleton + thread through AgentDispatchArgs`
2. `refactor(api): widen SkillContext with agentInstanceId + dispatcher + parentRunArgs`
3. `feat(api): add delegateToSpecialist skill and runtime aggregation for delegated assets`
4. `feat(api): add Controller AgentTemplate with delegateToSpecialist skill`
5. `feat(api): add acyclic validation for canDelegateTo in syncTemplates`
6. `refactor(api): handler routes inbound to Controller (delegates to Designer)`

Use `superpowers:finishing-a-development-branch` to choose merge / PR / hold.

---

## Self-review notes

**Spec coverage (§4 + §6 + §11 phase 5d):**

| Spec requirement                                                     | Implemented in | Verified by                                                             |
| -------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `delegateToSpecialist` skill with subtask + targetTemplateSlug input | Task 4         | 5 unit tests for the skill                                              |
| Controller template with `canDelegateTo: ["designer"]`               | Task 5         | Template registry test                                                  |
| `validateCanDelegateTo` acyclic + reference integrity                | Task 6         | 5 validation tests (5c deferred work delivered)                         |
| Runtime aggregates generatedAssetIds from delegation tool-results    | Task 4         | Runtime aggregation test                                                |
| Handler routes inbound to Controller                                 | Task 7         | Handler test + live verify                                              |
| SkillContext widened with agentInstanceId, dispatcher, parentRunArgs | Task 3         | Type + test updates across all 4 skill tests                            |
| Dispatcher promoted to module-level singleton                        | Task 2         | `index.ts` (or `agents/main-dispatcher.ts`) holds the single allocation |
| Existing 3 domain skills unchanged                                   | Tasks 3-7      | grep — no execute-function edits                                        |
| Bot behavior unchanged from user's perspective                       | Task 8         | Two live Telegram tests (text + image)                                  |

**Placeholder scan:** No "TBD", "TODO", "implement later", or "appropriate" in step bodies. Every code block is complete.

**Type consistency check:**

- `SkillContext` fields used identically across runtime + delegation skill: `agentInstanceId`, `dispatcher`, `orgId`, `parentRunArgs`, `prisma`.
- `AgentDispatchArgs.dispatcher: AgentDispatcher` matches the type's own dispatcher.
- `delegateToSpecialistSkill.id === "delegateToSpecialist"` matches Controller's `defaultEnabledSkillIds[0]`.
- Controller `canDelegateTo` value `"designer"` matches Designer's `slug`.

**Risk for Phase 5e (Marketing Strategist):**

- The acyclic validator now catches misconfigured `canDelegateTo`. Phase 5e adds `marketing-strategist` template with `canDelegateTo: ["designer"]` — that extends the DAG (`controller → marketing-strategist → designer`) and forms no cycle. Validator handles it.
- The delegation skill's child upsert uses `displayName: targetTemplate.displayName` (from the in-code template), which means the DB row's displayName always matches the template's. Phase 5d uses "Designer". Phase 5e will introduce "Marketing Strategist".
- The runtime aggregator only walks ONE level of delegation results per step. Multi-level delegation (Controller → MarketingStrategist → Designer) works because each level's delegation skill propagates the child's `generatedAssetIds` into its own tool-result output. Phase 5e doesn't need a new aggregation pattern — the existing one is depth-recursive at the skill level, not the runtime level.

**Known dispatchabe edge cases:**

- Designer's `defaultMission` is `""`. Controller's `defaultMission` is `""`. Custom missions per-AgentInstance are introduced in a later phase (when web UI exists). For Phase 5d, both run with template defaults.
- The handler's lazy-upsert uses `update: {}` — meaning if a Controller AgentInstance already exists for the org (from a prior phase), its `displayName`/`mission` are NOT overwritten. This is intentional: a future per-org rename of `displayName` should not be undone by handler runs.
