# Qolmeia Phase 2 — Audio → Soul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn inbound Telegram audio/text into a populated `Organization.businessProfile` via Vercel AI Gateway + `gemini-2.5-flash`, then reply in pt-BR with what was captured and what's still missing.

**Architecture:** New `apps/api/src/lib/ai.ts` wraps the AI SDK `generateObject` call. `soul/extract.ts` (orchestrator) → `soul/apply.ts` (patch-merge writer, the only writer of `businessProfile`) → `soul/reply.ts` (pt-BR templates from `soul/labels.ts`). Handler extended with DI deps for `extractSoul`/`applySoulUpdate` so tests stay DB-free and AI-free.

**Tech Stack:** Vercel AI SDK (`ai`), `@ai-sdk/google`, Vercel AI Gateway routing via `AI_GATEWAY_API_KEY`, Zod schemas, Prisma transactions, Chat SDK `concurrency: "queue"`, Vitest with `vi.mock` + DI.

**Spec:** `docs/superpowers/specs/2026-05-19-qolmeia-phase-2-audio-soul-design.md`

---

## Task 2.1: Add AI SDK deps + promote `AI_GATEWAY_API_KEY`

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/lib/env.test.ts`
- Modify: `apps/api/src/lib/vitest-setup.ts`

- [ ] **Step 1: Install AI SDK deps**

Run: `pnpm --filter api add ai @ai-sdk/google`
Expected: both packages added to `apps/api/package.json` dependencies, install succeeds.

> Verify they're real Vercel AI SDK packages: `npm view ai repository` should show `github.com/vercel/ai`. If `pnpm add` resolves either to an unrelated package, STOP and report.

- [ ] **Step 2: Promote `AI_GATEWAY_API_KEY` to required in `apps/api/src/lib/env.ts`**

Find the line:
```ts
  AI_GATEWAY_API_KEY: z.string().optional(),
```
Replace with:
```ts
  AI_GATEWAY_API_KEY: z.string().min(1),
```

- [ ] **Step 3: Add `AI_GATEWAY_API_KEY` stub to `apps/api/src/lib/vitest-setup.ts`**

Append a line after the existing stubs:
```ts
vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
```

- [ ] **Step 4: Extend env.test.ts base object**

In `apps/api/src/lib/env.test.ts`, the `base` object must include `AI_GATEWAY_API_KEY: "test-key"` so the "parses a valid minimal env" test still parses. Edit the `base` to:
```ts
const base = {
  AI_GATEWAY_API_KEY: "test-key",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_BOT_USERNAME: "qolmeia_bot",
  TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret",
};
```

- [ ] **Step 5: Verify gates**

Run: `pnpm --filter api typecheck && pnpm --filter api lint && pnpm test`
Expected: all green; 27 tests still pass; lint 0/0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/lib/env.ts apps/api/src/lib/env.test.ts apps/api/src/lib/vitest-setup.ts
git commit -m "feat(api): add Vercel AI SDK + @ai-sdk/google; promote AI_GATEWAY_API_KEY to required"
```

---

## Task 2.2: `lib/ai.ts` — `extractSoul` wrapper (TDD)

**Files:**
- Create: `apps/api/src/lib/ai.ts`
- Test: `apps/api/src/lib/ai.test.ts`

- [ ] **Step 1: Write the failing test `apps/api/src/lib/ai.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

// eslint-disable-next-line import/order -- vi.mock must precede import of module under test
import { generateObject } from "ai";

import { extractSoul, type Input } from "./ai";

const mockedGenerateObject = vi.mocked(generateObject);

const stubGenerate = (object: unknown) => {
  mockedGenerateObject.mockResolvedValue({
    object,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  } as never);
};

describe("extractSoul", () => {
  it("calls generateObject with the model, schema, system prompt, and text input", async () => {
    stubGenerate({
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: "Salão de cabelo",
    });

    const input: Input = { kind: "text", text: "Sou um salão de cabelo" };
    const result = await extractSoul(input, "(perfil vazio)");

    expect(mockedGenerateObject).toHaveBeenCalledOnce();
    const args = mockedGenerateObject.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ text?: string; type: string }>; role: string }>;
      system: string;
    };
    expect(args.system).toContain("(perfil vazio)");
    expect(args.system).toContain("não invente");
    expect(args.messages[0]!.role).toBe("user");
    expect(args.messages[0]!.content[0]!.type).toBe("text");
    expect(args.messages[0]!.content[0]!.text).toBe("Sou um salão de cabelo");

    expect(result.partial.whatYouDo).toBe("Salão de cabelo");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("sends audio bytes as a file content part", async () => {
    stubGenerate({
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: null,
    });
    const bytes = new Uint8Array([1, 2, 3]);

    await extractSoul(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "# Business Context\n\nwhatYouDo: salão",
    );

    const args = mockedGenerateObject.mock.calls.at(-1)![0] as {
      messages: Array<{ content: Array<{ data?: Uint8Array; mediaType?: string; type: string }> }>;
      system: string;
    };
    expect(args.system).toContain("whatYouDo: salão");
    expect(args.messages[0]!.content[0]!.type).toBe("file");
    expect(args.messages[0]!.content[0]!.data).toBe(bytes);
    expect(args.messages[0]!.content[0]!.mediaType).toBe("audio/ogg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/lib/ai.test.ts`
Expected: FAIL — `Cannot find module './ai'`.

- [ ] **Step 3: Implement `apps/api/src/lib/ai.ts`**

```ts
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

import { env } from "./env";

// Fail-fast at module load if AI_GATEWAY_API_KEY is missing.
void env.AI_GATEWAY_API_KEY;

const partialSoulSchema = z.object({
  competitors: z.string().nullable(),
  contextLinks: z.array(z.string()).nullable(),
  targetAudience: z.string().nullable(),
  whatYouDeliver: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

type PartialSoul = z.infer<typeof partialSoulSchema>;

type AudioInput = { bytes: Uint8Array; kind: "audio"; mediaType: string };
type TextInput = { kind: "text"; text: string };
type Input = AudioInput | TextInput;

type Usage = { inputTokens: number; outputTokens: number };

const SYSTEM_PROMPT_TEMPLATE = `Você extrai informações de negócio do dono.
Aqui está o perfil atual:
{{currentContext}}
A mensagem do usuário pode estar em áudio ou texto, em português brasileiro.
Atualize SOMENTE os campos que a mensagem deixa explícitos. Preserve correções (ex.: "na verdade meus concorrentes são X"). não invente; deixe campos não mencionados como null.`;

const renderSystemPrompt = (currentContext: string): string =>
  SYSTEM_PROMPT_TEMPLATE.replace(
    "{{currentContext}}",
    currentContext.length > 0 ? currentContext : "(perfil vazio)",
  );

const toUserContent = (input: Input) => {
  if (input.kind === "audio") {
    return [{ data: input.bytes, mediaType: input.mediaType, type: "file" as const }];
  }
  return [{ text: input.text, type: "text" as const }];
};

const extractSoul = async (
  input: Input,
  currentContext: string,
): Promise<{ partial: PartialSoul; usage: Usage }> => {
  const result = await generateObject({
    messages: [{ content: toUserContent(input), role: "user" }],
    model: google("gemini-2.5-flash"),
    schema: partialSoulSchema,
    system: renderSystemPrompt(currentContext),
    temperature: 0.2,
  });

  return {
    partial: result.object,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { extractSoul, partialSoulSchema };
export type { AudioInput, Input, PartialSoul, TextInput, Usage };
```

> **Implementer risk:** the AI SDK version installed determines the exact way to route `google("gemini-2.5-flash")` through the Vercel AI Gateway with only `AI_GATEWAY_API_KEY` set (no `GOOGLE_GENERATIVE_AI_API_KEY`). Inspect `node_modules/ai` and `node_modules/@ai-sdk/google` types. If `google("…")` does NOT auto-route via gateway with only `AI_GATEWAY_API_KEY`, switch the model to the gateway-string form (e.g. `model: "google/gemini-2.5-flash"`) or import the gateway provider explicitly. Preserve the function signature and test expectations.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/lib/ai.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full gates**

Run: `pnpm --filter api typecheck && pnpm --filter api lint && pnpm test`
Expected: all green; lint 0/0 (apply key sorting if perfectionist complains — preserve behavior); test count grows by 2.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/ai.ts apps/api/src/lib/ai.test.ts
git commit -m "feat(api): lib/ai extractSoul (Gemini 2.5-flash via Gateway)"
```

---

## Task 2.3: `soul/labels.ts` — pt-BR field labels

**Files:**
- Create: `apps/api/src/soul/labels.ts`
- Test: `apps/api/src/soul/labels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { SOUL_FIELDS } from "./soul";
import { SOUL_LABELS_PT } from "./labels";

describe("SOUL_LABELS_PT", () => {
  it("has a non-empty pt-BR label for every SoulProfile field", () => {
    for (const field of SOUL_FIELDS) {
      expect(SOUL_LABELS_PT[field]).toBeTypeOf("string");
      expect(SOUL_LABELS_PT[field].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/soul/labels.test.ts`
Expected: FAIL — `Cannot find module './labels'`.

- [ ] **Step 3: Implement `apps/api/src/soul/labels.ts`**

```ts
import type { SoulProfile } from "./soul";

const SOUL_LABELS_PT: Record<keyof SoulProfile, string> = {
  competitors: "seus concorrentes",
  contextLinks: "links sobre o negócio",
  targetAudience: "seu público-alvo",
  whatYouDeliver: "o que vocês entregam",
  whatYouDo: "o que vocês fazem",
};

export { SOUL_LABELS_PT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/soul/labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/soul/labels.ts apps/api/src/soul/labels.test.ts
git commit -m "feat(api): pt-BR soul field labels"
```

---

## Task 2.4: `soul/reply.ts` — deterministic pt-BR reply (TDD)

**Files:**
- Create: `apps/api/src/soul/reply.ts`
- Test: `apps/api/src/soul/reply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { buildReply } from "./reply";
import type { SoulProfile } from "./soul";

const empty: SoulProfile = {};

const populated: SoulProfile = {
  competitors: "Salão Y",
  contextLinks: ["https://example.com"],
  targetAudience: "moradores do bairro",
  whatYouDeliver: "corte e barba",
  whatYouDo: "salão de cabelo",
};

describe("buildReply", () => {
  it("joins captured + missing when both non-empty", () => {
    const reply = buildReply(
      { whatYouDo: "salão" },
      ["whatYouDo"],
    );
    expect(reply).toBe(
      "Anotei: o que vocês fazem. Ainda preciso saber: seu público-alvo, o que vocês entregam, seus concorrentes e links sobre o negócio.",
    );
  });

  it("uses comma + ' e ' for three-item captured lists", () => {
    const reply = buildReply(
      { competitors: "X", targetAudience: "donas de casa", whatYouDo: "salão" },
      ["whatYouDo", "targetAudience", "competitors"],
    );
    expect(reply).toContain("Anotei: o que vocês fazem, seu público-alvo e seus concorrentes.");
  });

  it("celebrates completeness when nothing is missing", () => {
    const reply = buildReply(populated, ["competitors"]);
    expect(reply).toBe("Tudo capturado! Você pode me corrigir a qualquer momento.");
  });

  it("nudges with the first missing field when nothing was captured", () => {
    const reply = buildReply(empty, []);
    expect(reply).toBe(
      "Não consegui captar nada útil dessa mensagem. Pode tentar descrever o que vocês fazem?",
    );
  });

  it("returns the all-set-no-change fallback when complete and nothing new", () => {
    const reply = buildReply(populated, []);
    expect(reply).toBe("Tudo certo, nada novo por aqui.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/soul/reply.test.ts`
Expected: FAIL — `Cannot find module './reply'`.

- [ ] **Step 3: Implement `apps/api/src/soul/reply.ts`**

```ts
import { SOUL_LABELS_PT } from "./labels";
import { missingSoulFields, type SoulProfile } from "./soul";

const joinPt = (labels: ReadonlyArray<string>): string => {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  const head = labels.slice(0, -1).join(", ");
  return `${head} e ${labels.at(-1)!}`;
};

const buildReply = (
  newProfile: SoulProfile,
  capturedFields: ReadonlyArray<keyof SoulProfile>,
): string => {
  const missing = missingSoulFields(newProfile);
  const capturedLabels = capturedFields.map((f) => SOUL_LABELS_PT[f]);
  const missingLabels = missing.map((f) => SOUL_LABELS_PT[f]);

  if (capturedFields.length > 0 && missing.length > 0) {
    return `Anotei: ${joinPt(capturedLabels)}. Ainda preciso saber: ${joinPt(missingLabels)}.`;
  }
  if (capturedFields.length > 0 && missing.length === 0) {
    return "Tudo capturado! Você pode me corrigir a qualquer momento.";
  }
  if (capturedFields.length === 0 && missing.length > 0) {
    return `Não consegui captar nada útil dessa mensagem. Pode tentar descrever ${missingLabels[0]!}?`;
  }
  return "Tudo certo, nada novo por aqui.";
};

export { buildReply };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/soul/reply.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/soul/reply.ts apps/api/src/soul/reply.test.ts
git commit -m "feat(api): pt-BR reply builder (captured + missing branches)"
```

---

## Task 2.5: `soul/apply.ts` — patch-merge writer (TDD)

**Files:**
- Create: `apps/api/src/soul/apply.ts`
- Test: `apps/api/src/soul/apply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    organization: tx.organization,
    _tx: tx,
    _updated: updated,
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

    expect(result.newProfile.whatYouDo).toBe("salão"); // preserved (null in partial)
    expect(result.newProfile.targetAudience).toBe("novo público"); // overwritten
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/soul/apply.test.ts`
Expected: FAIL — `Cannot find module './apply'`.

- [ ] **Step 3: Implement `apps/api/src/soul/apply.ts`**

```ts
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

const applySoulUpdate = async (
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
      row?.businessProfile && typeof row.businessProfile === "object"
        ? (row.businessProfile as SoulProfile)
        : {};

    const next: SoulProfile = { ...existing };
    const captured: Array<keyof SoulProfile> = [];

    for (const field of SOUL_FIELDS) {
      const incoming = partial[field];
      if (incoming === undefined || incoming === null) continue;

      if (field === "contextLinks") {
        const merged = dedupe([...(existing.contextLinks ?? []), ...(incoming as Array<string>)]);
        const before = existing.contextLinks ?? [];
        const changed = merged.length !== before.length || merged.some((v, i) => v !== before[i]);
        next.contextLinks = merged;
        if (changed) captured.push("contextLinks");
        continue;
      }

      const scalarIncoming = incoming as string;
      const scalarExisting = existing[field] as string | undefined;
      if (scalarIncoming !== scalarExisting) {
        // Narrow assignment per field key to satisfy TS.
        if (field === "whatYouDo") next.whatYouDo = scalarIncoming;
        else if (field === "targetAudience") next.targetAudience = scalarIncoming;
        else if (field === "whatYouDeliver") next.whatYouDeliver = scalarIncoming;
        else if (field === "competitors") next.competitors = scalarIncoming;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/soul/apply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/soul/apply.ts apps/api/src/soul/apply.test.ts
git commit -m "feat(api): applySoulUpdate (patch-merge soul writer in Prisma tx)"
```

---

## Task 2.6: `soul/extract.ts` — orchestrator (TDD)

**Files:**
- Create: `apps/api/src/soul/extract.ts`
- Test: `apps/api/src/soul/extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/ai", () => ({
  extractSoul: vi.fn(),
}));

// eslint-disable-next-line import/order -- vi.mock must precede import of module under test
import { extractSoul as mockedExtract } from "../lib/ai";

import { extractFromMessage } from "./extract";

const mocked = vi.mocked(mockedExtract);

const stubReturn = () =>
  mocked.mockResolvedValue({
    partial: {
      competitors: null,
      contextLinks: null,
      targetAudience: null,
      whatYouDeliver: null,
      whatYouDo: "salão",
    },
    usage: { inputTokens: 1, outputTokens: 1 },
  });

describe("extractFromMessage", () => {
  it("builds a text input from a text message and passes the current context", async () => {
    stubReturn();
    const result = await extractFromMessage(
      { kind: "text", text: "sou um salão" },
      "# Business Context\n\nwhatYouDo: x",
    );
    expect(result.partial.whatYouDo).toBe("salão");
    expect(mocked).toHaveBeenCalledWith(
      { kind: "text", text: "sou um salão" },
      "# Business Context\n\nwhatYouDo: x",
    );
  });

  it("builds an audio input and forwards bytes + mediaType", async () => {
    stubReturn();
    const bytes = new Uint8Array([9, 9]);
    await extractFromMessage(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "(perfil vazio)",
    );
    expect(mocked).toHaveBeenCalledWith(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "(perfil vazio)",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/soul/extract.test.ts`
Expected: FAIL — `Cannot find module './extract'`.

- [ ] **Step 3: Implement `apps/api/src/soul/extract.ts`**

```ts
import { extractSoul, type Input, type PartialSoul, type Usage } from "../lib/ai";

const extractFromMessage = async (
  input: Input,
  currentContext: string,
): Promise<{ partial: PartialSoul; usage: Usage }> => extractSoul(input, currentContext);

export { extractFromMessage };
export type { Input, PartialSoul };
```

> The orchestrator is intentionally thin in Phase 2 (one call, no branching). Keeping it as its own module preserves the seam — Phase 3 may add pre/post processing (e.g. running the same call against an asset upload) without touching `lib/ai.ts` or `handler.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/soul/extract.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/soul/extract.ts apps/api/src/soul/extract.test.ts
git commit -m "feat(api): extractFromMessage orchestrator seam"
```

---

## Task 2.7: Wire `handler.ts` to extract → apply → reply (TDD)

**Files:**
- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`

- [ ] **Step 1: Extend `handler.test.ts` with the new behaviors (RED)**

Replace `apps/api/src/telegram/handler.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import { handleIncomingMessage } from "./handler";

const makeThread = () => ({ id: "tg_chat_42", post: vi.fn().mockResolvedValue(undefined) });

const makeMessage = (
  over: Partial<{
    attachments: Array<{ fetchData?: () => Promise<Uint8Array>; mimeType?: string; name?: string }>;
    id: string;
    text: string;
  }> = {},
) => ({
  attachments: over.attachments ?? [],
  id: over.id ?? "msg_1",
  text: over.text ?? "olá",
});

const makePrisma = () => {
  const org = { id: "org_1" };
  const conversation = { id: "conv_1" };
  return {
    conversation: {
      create: vi.fn().mockResolvedValue(conversation),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    message: { create: vi.fn().mockResolvedValue({ id: "m_1" }) },
    organization: { create: vi.fn().mockResolvedValue(org) },
    telegramLink: { findUnique: vi.fn().mockResolvedValue(null) },
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: "wh_1" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as never;
};

const makeDeps = (over: Partial<{
  applySoulUpdate: ReturnType<typeof vi.fn>;
  extractFromMessage: ReturnType<typeof vi.fn>;
  getBusinessContext: ReturnType<typeof vi.fn>;
  prisma: ReturnType<typeof makePrisma>;
}> = {}) => {
  const prisma = over.prisma ?? makePrisma();
  return {
    applySoulUpdate:
      over.applySoulUpdate ??
      vi.fn().mockResolvedValue({ capturedFields: ["whatYouDo"], newProfile: { whatYouDo: "salão" } }),
    extractFromMessage:
      over.extractFromMessage ??
      vi.fn().mockResolvedValue({
        partial: { whatYouDo: "salão" },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    getBusinessContext: over.getBusinessContext ?? vi.fn().mockResolvedValue(""),
    prisma,
  };
};

describe("handleIncomingMessage", () => {
  it("creates org+conversation+message and replies with the captured/missing summary", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    expect((deps.prisma as never as { organization: { create: ReturnType<typeof vi.fn> } }).organization.create).toHaveBeenCalledOnce();
    expect((deps.prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create).toHaveBeenCalledOnce();
    expect(deps.extractFromMessage).toHaveBeenCalledOnce();
    expect(deps.applySoulUpdate).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledOnce();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Anotei: o que vocês fazem.");
    expect(reply).toContain("Ainda preciso saber:");
  });

  it("is idempotent — duplicate message id is a no-op", async () => {
    const prisma = makePrisma();
    (prisma as never as { webhookEvent: { findUnique: ReturnType<typeof vi.fn> } }).webhookEvent.findUnique.mockResolvedValue({ id: "wh_1" });
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage());

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    expect(deps.applySoulUpdate).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });

  it("downloads audio attachments and forwards bytes to extractFromMessage", async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const fetchData = vi.fn().mockResolvedValue(bytes);
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "audio/ogg", name: "voice.ogg" }],
        text: "",
      }),
    );

    expect(fetchData).toHaveBeenCalledOnce();
    expect(deps.extractFromMessage).toHaveBeenCalledWith(
      { bytes, kind: "audio", mediaType: "audio/ogg" },
      "",
    );
  });

  it("replies with the nothing-captured nudge for empty text without calling extract", async () => {
    const deps = makeDeps({
      applySoulUpdate: vi.fn(),
      extractFromMessage: vi.fn(),
    });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "   " }));

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    expect(deps.applySoulUpdate).not.toHaveBeenCalled();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Não consegui captar nada útil");
  });

  it("apologises (not throws) when audio download fails", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData: () => Promise.reject(new Error("boom")), mimeType: "audio/ogg" }],
        text: "",
      }),
    );

    expect(deps.extractFromMessage).not.toHaveBeenCalled();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Não consegui baixar seu áudio");
  });

  it("apologises (not throws) when extractFromMessage fails", async () => {
    const deps = makeDeps({
      extractFromMessage: vi.fn().mockRejectedValue(new Error("rate-limited")),
    });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    expect(deps.applySoulUpdate).not.toHaveBeenCalled();
    const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(reply).toContain("Tive um problema processando sua mensagem");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter api exec vitest run src/telegram/handler.test.ts`
Expected: FAIL — the handler still posts the fixed ACK and `HandlerDeps` doesn't accept the new keys.

- [ ] **Step 3: Replace `apps/api/src/telegram/handler.ts`**

```ts
import type { PrismaClient } from "@repo/db";

import { logger } from "../lib/logger";
import { applySoulUpdate as applySoulUpdateDefault } from "../soul/apply";
import { extractFromMessage as extractFromMessageDefault } from "../soul/extract";
import { getBusinessContext as getBusinessContextDefault } from "../soul/knowledge-provider";
import { buildReply } from "../soul/reply";
import type { SoulProfile } from "../soul/soul";

type IncomingAttachment = {
  fetchData?: () => Promise<Uint8Array>;
  mimeType?: string;
  name?: string;
};

type IncomingMessage = {
  attachments?: Array<IncomingAttachment>;
  id: string;
  text?: string;
};

type IncomingThread = {
  id: string;
  post: (text: string) => Promise<unknown>;
};

type HandlerDeps = {
  applySoulUpdate?: typeof applySoulUpdateDefault;
  extractFromMessage?: typeof extractFromMessageDefault;
  getBusinessContext?: typeof getBusinessContextDefault;
  prisma: Pick<PrismaClient, "$transaction" | "conversation" | "message" | "organization" | "telegramLink" | "webhookEvent">;
};

const DOWNLOAD_FAILED_REPLY = "Não consegui baixar seu áudio, pode reenviar?";
const EXTRACT_FAILED_REPLY = "Tive um problema processando sua mensagem, pode tentar de novo?";

const slugify = (chatId: string): string => `org-tg-${chatId}`.toLowerCase();

const findAudioAttachment = (attachments: ReadonlyArray<IncomingAttachment>) =>
  attachments.find((a) => (a.mimeType ?? "").startsWith("audio"));

const handleIncomingMessage = async (
  deps: HandlerDeps,
  thread: IncomingThread,
  message: IncomingMessage,
): Promise<void> => {
  const {
    applySoulUpdate = applySoulUpdateDefault,
    extractFromMessage = extractFromMessageDefault,
    getBusinessContext = getBusinessContextDefault,
    prisma,
  } = deps;

  // Durable audit + idempotency (complements the adapter's in-memory dedup).
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { externalId: message.id, provider: "telegram" } },
  });
  if (existing) return;
  await prisma.webhookEvent.create({
    data: { externalId: message.id, payload: { ...message }, provider: "telegram" },
  });

  // Resolve identity: one Telegram chat == one Organization.
  let link = await prisma.telegramLink.findUnique({
    select: { orgId: true },
    where: { telegramChatId: thread.id },
  });
  if (!link) {
    const org = await prisma.organization.create({
      data: {
        conversations: { create: { channel: "TELEGRAM", externalId: thread.id } },
        name: `Negócio ${thread.id}`,
        slug: slugify(thread.id),
        telegramLink: { create: { telegramChatId: thread.id } },
      },
      select: { id: true },
    });
    link = { orgId: org.id };
  }

  const conversation =
    (await prisma.conversation.findFirst({
      select: { id: true },
      where: { channel: "TELEGRAM", orgId: link.orgId },
    })) ??
    (await prisma.conversation.create({
      data: { channel: "TELEGRAM", externalId: thread.id, orgId: link.orgId },
      select: { id: true },
    }));

  const audio = findAudioAttachment(message.attachments ?? []);
  const hasAudio = audio !== undefined;

  await prisma.message.create({
    data: {
      content: message.text ?? "",
      contentType: hasAudio ? "AUDIO" : "TEXT",
      conversationId: conversation.id,
      externalId: message.id,
      metadata: { attachments: message.attachments ?? [] },
      sender: "CUSTOMER",
    },
  });

  // Build Input. Skip extract if text is empty/whitespace and no audio.
  const text = (message.text ?? "").trim();
  if (!hasAudio && text.length === 0) {
    const empty: SoulProfile = {};
    await thread.post(buildReply(empty, []));
    return;
  }

  let bytes: Uint8Array;
  if (hasAudio) {
    try {
      if (!audio.fetchData) throw new Error("attachment has no fetchData");
      bytes = await audio.fetchData();
    } catch (error) {
      logger.error(
        { chatId: thread.id, error, messageId: message.id },
        "audio.download_failed",
      );
      await thread.post(DOWNLOAD_FAILED_REPLY);
      return;
    }
  } else {
    bytes = new Uint8Array(); // unused for text path
  }

  const currentContext = await getBusinessContext(link.orgId);

  let result: Awaited<ReturnType<typeof extractFromMessage>>;
  try {
    result = hasAudio
      ? await extractFromMessage(
          { bytes, kind: "audio", mediaType: audio.mimeType ?? "audio/ogg" },
          currentContext,
        )
      : await extractFromMessage({ kind: "text", text }, currentContext);
  } catch (error) {
    logger.error({ chatId: thread.id, error, messageId: message.id }, "extract.failed");
    await thread.post(EXTRACT_FAILED_REPLY);
    return;
  }

  const { capturedFields, newProfile } = await applySoulUpdate(
    link.orgId,
    result.partial,
    prisma,
  );

  const reply = buildReply(newProfile, capturedFields);
  await thread.post(reply);

  logger.info(
    {
      capturedFields,
      chatId: thread.id,
      kind: hasAudio ? "audio" : "text",
      messageId: message.id,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
    },
    "telegram message handled",
  );
};

export { handleIncomingMessage };
export type { HandlerDeps, IncomingMessage, IncomingThread };
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter api exec vitest run src/telegram/handler.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full gates**

Run: `pnpm --filter api typecheck && pnpm --filter api lint && pnpm test`
Expected: all green; lint 0/0 (apply key sorting if perfectionist complains).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
git commit -m "feat(api): handler runs soul extract pipeline + pt-BR reply with missing fields"
```

---

## Task 2.8: `bot.ts` — explicit `concurrency: "queue"`

**Files:**
- Modify: `apps/api/src/telegram/bot.ts`

- [ ] **Step 1: Add `concurrency: "queue"` to the `new Chat({…})` config and reference `env.AI_GATEWAY_API_KEY` for fail-fast**

Current config (lines ~16–21):
```ts
const bot = new Chat({
  adapters: { telegram: createTelegramAdapter({ mode: "webhook" }) },
  logger: "info",
  state: createRedisState(),
  userName: env.TELEGRAM_BOT_USERNAME,
});
```

Replace with:
```ts
const bot = new Chat({
  adapters: { telegram: createTelegramAdapter({ mode: "webhook" }) },
  concurrency: "queue",
  logger: "info",
  state: createRedisState(),
  userName: env.TELEGRAM_BOT_USERNAME,
});
```

Also add a `void env.AI_GATEWAY_API_KEY;` line alongside the existing `void env.X` block so the bot module also fails fast if the AI key is missing.

> Implementer risk: confirm the Chat SDK config type accepts `concurrency: "queue"` (Phase 1 review noted the option). If the literal `"queue"` isn't accepted (older `chat` version), inspect `node_modules/chat/dist/index.d.ts` for the exact enum/string values and adjust.

- [ ] **Step 2: Verify gates**

Run: `pnpm --filter api typecheck && pnpm --filter api lint && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/telegram/bot.ts
git commit -m "feat(api): bot concurrency: queue (per-chat serialization)"
```

---

## Task 2.9: Full verification + branch finishing

- [ ] **Step 1: Final gate from clean**

Run: `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. Test count grew by 2 (env) + 2 (ai) + 1 (labels) + 5 (reply) + 4 (apply) + 2 (extract) + 4 new handler tests (replacing old 2) = +20 tests from Phase 1's 27 → ~47 tests. Confirm actual count.

- [ ] **Step 2: `acme` grep clean + `portless` grep clean**

Run:
```bash
grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
grep -rniI portless . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
```
Expected: both empty.

- [ ] **Step 3: Boot smoke (no live AI call required)**

```bash
docker compose up -d
sleep 2
(cd apps/api && node dist/index.mjs > /tmp/qolmeia-phase2-smoke.log 2>&1 &)
sleep 4
curl -s localhost:4000/healthz
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:4000/telegram/webhook -H 'content-type: application/json' -d '{}'
grep -i 'poll' /tmp/qolmeia-phase2-smoke.log || echo "(no poll lines — webhook-only mode preserved)"
# kill the spawned node process (find its pid):
kill %1 2>/dev/null || true
```
Expected:
- `/healthz` returns healthy JSON.
- Webhook POST → **401** (adapter rejects unsigned body — proves the route + adapter are wired).
- No "Telegram polling started" lines (webhook-only mode preserved from Phase 1).

- [ ] **Step 4: Final whole-implementation review subagent**

Dispatch a final reviewer subagent covering all Phase 2 commits since the branch base. Validate spec coverage end-to-end (every spec section maps to a task), Seam #1 still airtight (only `KnowledgeProvider` reads `businessProfile`; only `applySoulUpdate` writes it — grep `businessProfile` across `apps/api/src` and confirm), no over-build, no Phase 3/4 work leaked in.

- [ ] **Step 5: Finish the branch**

Invoke the `superpowers:finishing-a-development-branch` skill to present integration options to the user (merge to main locally / push + PR / keep as-is / discard). Do NOT auto-merge or push.

---

## Self-review (completed during planning)

- **Spec coverage:** §2 module layout → Tasks 2.2–2.6 + 2.7 (handler integration); §3 data flow → Task 2.7 (handler rewrite); §4 prompt/schema → Task 2.2 (`ai.ts`); §5 merge → Task 2.5 (`apply.ts`); §6 reply templates → Task 2.4 (`reply.ts`) + 2.3 (`labels.ts`); §7 errors/concurrency/observability → Task 2.7 (download/extract apologies + Pino log) + Task 2.8 (`concurrency: "queue"`); §8 env change → Task 2.1; §9 testing → coverage spans every TDD task; §10 out of scope → respected (no R2, no image gen, no LLM-built replies, `competitors` stays `string`).
- **Placeholder scan:** none — every step has full code/commands.
- **Type consistency:** `Input` / `PartialSoul` / `Usage` defined in `lib/ai.ts` (Task 2.2), re-exported from `soul/extract.ts` (Task 2.6), consumed by `handler.ts` (Task 2.7). `SoulProfile` / `SOUL_FIELDS` / `missingSoulFields` come from existing `soul/soul.ts`. `applySoulUpdate(orgId, partial, prisma)` signature consistent across Tasks 2.5 → 2.7. `extractFromMessage(input, currentContext)` signature consistent across Tasks 2.6 → 2.7. `HandlerDeps` extended with three DI overrides matching the default imports they shadow. Reply strings consistent between Task 2.4 implementation and Task 2.7 test assertions ("Anotei: …", "Não consegui captar nada útil", "Não consegui baixar seu áudio", "Tive um problema processando sua mensagem").
