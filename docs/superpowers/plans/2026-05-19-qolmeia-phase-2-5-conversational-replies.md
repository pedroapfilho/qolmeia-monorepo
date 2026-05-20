# Qolmeia Phase 2.5 — Conversational Replies + Sharpen Soul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4 deterministic pt-BR templates with LLM-built replies via a single fused `generateObject` call returning `{ partial, reply }`, and sharpen the soul to 5 strong fields (`whatYouDo`, `targetAudience`, `differentiator`, `brandVoice`, `location`).

**Architecture:** Extend `lib/ai.ts`'s `generateObject` schema with a `reply` string field; rewrite the system prompt for capture + answer + deflect + brand-voice mirroring. Propagate `reply` through `extract.ts` to `handler.ts`, which posts it directly. Delete now-dead `soul/reply.ts` + `soul/labels.ts` + `missingSoulFields`. Update `soul/apply.ts` to scalar-only patch-merge (no array branch).

**Tech Stack:** Vercel AI SDK + `gateway("google/gemini-2.5-flash")`, Zod schemas, existing DI plumbing in the Telegram handler.

**Spec:** `docs/superpowers/specs/2026-05-19-qolmeia-phase-2-5-conversational-replies-design.md`

---

## Task 2.5.1: Migrate soul fields; delete dead modules; temp inline happy-path reply

This task does the big-coordinated-refactor in one commit so gates stay green. After it: soul has the new 5 fields, deterministic reply infrastructure is gone, handler posts a single temporary inline string on happy path (`"Recebi sua mensagem 👋"`). Subsequent tasks introduce the real LLM-built reply.

**Files:**
- Modify: `apps/api/src/soul/soul.ts`
- Modify: `apps/api/src/soul/apply.ts`
- Modify: `apps/api/src/soul/apply.test.ts`
- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`
- Delete: `apps/api/src/soul/labels.ts`
- Delete: `apps/api/src/soul/labels.test.ts`
- Delete: `apps/api/src/soul/reply.ts`
- Delete: `apps/api/src/soul/reply.test.ts`

- [ ] **Step 1: Branch state check**

Run: `git branch --show-current`
Expected: `qolmeia-phase-2-5-conversational-replies` (off `main` at `e49853a`). If not, `git checkout -B qolmeia-phase-2-5-conversational-replies main`.

- [ ] **Step 2: Replace `apps/api/src/soul/soul.ts`**

```ts
/** The 5 soul fields. All optional — filled incrementally (free-form accumulate). */
type SoulProfile = {
  brandVoice?: string;
  differentiator?: string;
  location?: string;
  targetAudience?: string;
  whatYouDo?: string;
};

const SOUL_FIELDS: ReadonlyArray<keyof SoulProfile> = [
  "whatYouDo",
  "targetAudience",
  "differentiator",
  "brandVoice",
  "location",
];

export { SOUL_FIELDS };
export type { SoulProfile };
```

(`missingSoulFields` removed — its only consumer was the deleted `reply.ts`.)

- [ ] **Step 3: Delete the dead modules**

```bash
cd /Users/pedroapfilho/dev/qolmeia-monorepo
rm apps/api/src/soul/reply.ts apps/api/src/soul/reply.test.ts
rm apps/api/src/soul/labels.ts apps/api/src/soul/labels.test.ts
```

- [ ] **Step 4: Replace `apps/api/src/soul/apply.test.ts`** with the new field-set tests

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
    _tx: tx,
    _updated: updated,
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
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
```

- [ ] **Step 5: Replace `apps/api/src/soul/apply.ts`** with scalar-only patch-merge over the new field set

```ts
import type { PrismaClient } from "@repo/db";

import type { PartialSoul } from "../lib/ai";
import { SOUL_FIELDS, type SoulProfile } from "./soul";

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
export type { ApplyPrisma };
```

> Note: `PartialSoul` is imported from `../lib/ai`. After Task 2.5.2 that type reflects the new schema; for now (between Task 2.5.1 and Task 2.5.2 commits) the old `PartialSoul` shape from Phase 2 still has the OLD field names. **Task 2.5.1's apply.ts will not typecheck against the old `PartialSoul`.** Resolution: do Task 2.5.1's lib/ai schema update in this same task. Concretely, after Step 5, also do Step 6 below before running gates.

- [ ] **Step 6: Update `apps/api/src/lib/ai.ts` to the new field set (schema-only, no reply yet)**

This is a partial update — the schema's field names change, the rest of `ai.ts` is unchanged. The system-prompt rewrite + adding `reply` happens in Task 2.5.2. Replace the `partialSoulSchema` block (only) with:

```ts
const partialSoulSchema = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});
```

Also update the system-prompt template to reference the new field names (still Phase-2-shape — just field renames; the conversational rewrite is Task 2.5.2). Replace `SYSTEM_PROMPT_TEMPLATE` with:

```ts
const SYSTEM_PROMPT_TEMPLATE = `Você extrai informações de negócio do dono.
Aqui está o perfil atual:
{{currentContext}}
A mensagem do usuário pode estar em áudio ou texto, em português brasileiro.

Campos a extrair:
- whatYouDo: o que vocês fazem e entregam
- targetAudience: seu público-alvo
- differentiator: o que diferencia vocês dos concorrentes
- brandVoice: tom de voz / personalidade da marca
- location: cidade / região de atuação

Atualize SOMENTE os campos que a mensagem deixa explícitos. Preserve correções (ex.: "na verdade meu público é X"). Não invente; deixe campos não mencionados como null.`;
```

- [ ] **Step 7: Update `apps/api/src/lib/ai.test.ts`** to reflect the renamed fields

Find the `stubGenerate` call in the first test and replace its object literal with the new shape:

```ts
stubGenerate({
  brandVoice: null,
  differentiator: null,
  location: null,
  targetAudience: null,
  whatYouDo: "Salão de cabelo",
});
```

And the second test's stub:

```ts
stubGenerate({
  brandVoice: null,
  differentiator: null,
  location: null,
  targetAudience: null,
  whatYouDo: null,
});
```

Update the second test's system-prompt assertion to match the new content. Change:

```ts
expect(args.system).toContain("whatYouDo: salão");
```

to:

```ts
expect(args.system).toContain("Campos a extrair:");
```

And in the first test, change:

```ts
expect(args.system).toContain("não invente");
```

to:

```ts
expect(args.system).toContain("Não invente");
```

(matching the capitalization in the new prompt).

- [ ] **Step 8: Replace `apps/api/src/telegram/handler.ts`** — drop `buildReply` import; happy path posts a temporary inline string

Replace the whole file with:

```ts
import type { PrismaClient } from "@repo/db";

import { logger } from "../lib/logger";
import { applySoulUpdate as applySoulUpdateDefault } from "../soul/apply";
import { extractFromMessage as extractFromMessageDefault } from "../soul/extract";
import { getBusinessContext as getBusinessContextDefault } from "../soul/knowledge-provider";

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

// Temporary inline reply for the happy path in Task 2.5.1; replaced by the
// LLM-built `result.reply` in Task 2.5.3.
const TEMP_HAPPY_REPLY = "Recebi sua mensagem 👋";
const EMPTY_TEXT_REPLY = "Recebi sua mensagem, mas não entendi. Pode tentar de novo?";
const DOWNLOAD_FAILED_REPLY = "Não consegui baixar seu áudio, pode reenviar?";
const EXTRACT_FAILED_REPLY = "Tive um problema processando sua mensagem, pode tentar de novo?";

const slugify = (chatId: string): string => `org-tg-${chatId}`.toLowerCase();

const findAudioAttachment = (attachments: ReadonlyArray<IncomingAttachment>) =>
  attachments.find((a) => (a.mimeType ?? "").startsWith("audio"));

// Prisma's Json columns can't store functions (the SDK's attachments carry a
// `fetchData` AsyncFunction). Walk the value and strip anything not
// JSON-representable.
const toJsonSafe = (value: unknown): unknown => {
  if (value === null) {
    return null;
  }
  if (value === undefined || typeof value === "function") {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((v) => toJsonSafe(v)).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = toJsonSafe(v);
      if (cleaned !== undefined) {
        out[k] = cleaned;
      }
    }
    return out;
  }
  return value;
};

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

  try {
    const existing = await prisma.webhookEvent.findUnique({
      where: { provider_externalId: { externalId: message.id, provider: "telegram" } },
    });
    if (existing) {
      return;
    }
    await prisma.webhookEvent.create({
      data: {
        externalId: message.id,
        payload: toJsonSafe({ ...message }) as object,
        provider: "telegram",
      },
    });

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
        metadata: toJsonSafe({ attachments: message.attachments ?? [] }) as object,
        sender: "CUSTOMER",
      },
    });

    const text = (message.text ?? "").trim();
    if (!hasAudio && text.length === 0) {
      await thread.post(EMPTY_TEXT_REPLY);
      return;
    }

    let bytes: Uint8Array;
    if (hasAudio) {
      try {
        if (!audio.fetchData) {
          throw new Error("attachment has no fetchData");
        }
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
      bytes = new Uint8Array();
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

    const { capturedFields } = await applySoulUpdate(link.orgId, result.partial, prisma);

    await thread.post(TEMP_HAPPY_REPLY);

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
  } catch (error) {
    logger.error({ chatId: thread.id, error, messageId: message.id }, "handler.failed");
    try {
      await thread.post(EXTRACT_FAILED_REPLY);
    } catch (postError) {
      logger.error(
        { chatId: thread.id, error: postError, messageId: message.id },
        "handler.reply_failed",
      );
    }
  }
};

export { handleIncomingMessage };
export type { HandlerDeps, IncomingMessage, IncomingThread };
```

- [ ] **Step 9: Update `apps/api/src/telegram/handler.test.ts`** — drop buildReply-dependent assertions; update mocks for new field names; assert temp inline string

Change three things in the file:

(a) `makeDeps` default `extractFromMessage` mock partial — replace `{ partial: { whatYouDo: "salão" } }` with the new shape:
```ts
partial: {
  brandVoice: null,
  differentiator: null,
  location: null,
  targetAudience: null,
  whatYouDo: "salão",
},
```

(b) The "captured/missing summary" test currently asserts:
```ts
const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
expect(reply).toContain("Anotei: o que vocês fazem.");
expect(reply).toContain("Ainda preciso saber:");
```
Replace with:
```ts
expect(thread.post).toHaveBeenCalledWith("Recebi sua mensagem 👋");
```

(c) The "empty text" test currently asserts:
```ts
const reply = (thread.post as ReturnType<typeof vi.fn>).mock.calls[0]![0];
expect(reply).toContain("Não consegui captar nada útil");
```
Replace with:
```ts
expect(thread.post).toHaveBeenCalledWith("Recebi sua mensagem, mas não entendi. Pode tentar de novo?");
```

- [ ] **Step 10: Run gates — expect green**

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm test
```

Expected: typecheck clean; lint 0/0; tests pass (down from 47 to ~41 — we removed 6 deterministic tests from reply.test.ts + labels.test.ts, kept handler/apply/extract/ai/env/security/error-handler/knowledge-provider tests).

If oxlint complains about object-key ordering or unused-imports, apply alphabetical sorting and remove unused imports. Do NOT add disable comments.

- [ ] **Step 11: Confirm no acme/portless leakage, branch state**

```bash
grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
git branch --show-current   # must print qolmeia-phase-2-5-conversational-replies
```
Both must be: empty grep + correct branch.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(api): migrate soul to 5 sharpened fields; remove deterministic reply templates

- soul.ts: SoulProfile = { whatYouDo, targetAudience, differentiator, brandVoice, location }
- apply.ts: scalar-only patch-merge (no array branch)
- ai.ts: schema + system prompt updated to new field set
- handler.ts: happy path posts temporary inline reply (LLM reply wired in Task 2.5.3)
- delete soul/reply.ts + soul/labels.ts (+ tests) — dead after LLM replies"
```

Verify: `git log --oneline -2` shows this commit on top of `e49853a` (main).

---

## Task 2.5.2: lib/ai returns `{ partial, reply }` via fused generateObject

This task adds the `reply` field to the schema, rewrites the system prompt for capture + answer + deflect + brand-voice mirroring, and propagates `reply` through `extract.ts`. Handler is unchanged — it still posts the temp inline string from Task 2.5.1. Gates stay green because the new `reply` field is unused at the call site (additive change).

**Files:**
- Modify: `apps/api/src/lib/ai.ts`
- Modify: `apps/api/src/lib/ai.test.ts`
- Modify: `apps/api/src/soul/extract.ts`
- Modify: `apps/api/src/soul/extract.test.ts`

- [ ] **Step 1: Update `apps/api/src/lib/ai.test.ts`** (RED first)

Replace the `mockedGenerateObject.mockResolvedValue` call in `stubGenerate`:

```ts
const stubGenerate = (partial: unknown, reply: string) => {
  mockedGenerateObject.mockResolvedValue({
    object: { partial, reply },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  } as never);
};
```

Update the first test to call `stubGenerate` with both partial and reply, and add assertions on the propagated reply:

```ts
it("calls generateObject with the model, schema, system prompt, and text input", async () => {
  stubGenerate(
    {
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: null,
      whatYouDo: "Salão de cabelo",
    },
    "Anotei que vocês são um salão! Qual seu público-alvo?",
  );

  const input: Input = { kind: "text", text: "Sou um salão de cabelo" };
  const result = await extractSoul(input, "(perfil vazio)");

  expect(mockedGenerateObject).toHaveBeenCalledOnce();
  const args = mockedGenerateObject.mock.calls[0]![0] as {
    messages: Array<{ content: Array<{ text?: string; type: string }>; role: string }>;
    system: string;
  };
  expect(args.system).toContain("(perfil vazio)");
  expect(args.system).toContain("Você é um assistente onboarding");
  expect(args.system).toContain("brandVoice");
  expect(args.messages[0]!.role).toBe("user");
  expect(args.messages[0]!.content[0]!.type).toBe("text");
  expect(args.messages[0]!.content[0]!.text).toBe("Sou um salão de cabelo");

  expect(result.partial.whatYouDo).toBe("Salão de cabelo");
  expect(result.reply).toBe("Anotei que vocês são um salão! Qual seu público-alvo?");
  expect(result.usage.inputTokens).toBe(10);
  expect(result.usage.outputTokens).toBe(5);
});
```

Update the second test similarly — pass a `reply` string into `stubGenerate` and the audio assertion remains:

```ts
it("sends audio bytes as a file content part", async () => {
  stubGenerate(
    {
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: null,
      whatYouDo: null,
    },
    "Recebi seu áudio.",
  );
  const bytes = new Uint8Array([1, 2, 3]);

  const result = await extractSoul(
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
  expect(result.reply).toBe("Recebi seu áudio.");
});
```

- [ ] **Step 2: Run tests — expect RED**

`pnpm --filter api exec vitest run src/lib/ai.test.ts` — expect FAIL because `result.reply` is undefined and the schema doesn't have a `reply` field yet.

- [ ] **Step 3: Replace `apps/api/src/lib/ai.ts`**

```ts
import { gateway, generateObject } from "ai";
import { z } from "zod";

import { env } from "./env";

void env.AI_GATEWAY_API_KEY;

const partialSoulSchema = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

const interactionSchema = z.object({
  partial: partialSoulSchema,
  reply: z.string().min(1).max(500),
});

type PartialSoul = z.infer<typeof partialSoulSchema>;

type AudioInput = { bytes: Uint8Array; kind: "audio"; mediaType: string };
type TextInput = { kind: "text"; text: string };
type Input = AudioInput | TextInput;

type Usage = { inputTokens: number; outputTokens: number };

const SYSTEM_PROMPT_TEMPLATE = `Você é um assistente onboarding de negócio. O dono fala com você por texto ou áudio em português brasileiro.

Sua missão é dupla, em UMA resposta:
1) EXTRAIR (campo \`partial\`) qualquer informação sobre o negócio nas 5 áreas:
   - whatYouDo: o que vocês fazem e entregam
   - targetAudience: seu público-alvo
   - differentiator: o que diferencia vocês dos concorrentes
   - brandVoice: tom de voz / personalidade da marca
   - location: cidade / região de atuação
2) RESPONDER (campo \`reply\`) em pt-BR, 1-3 frases (máx 500 caracteres).

Perfil atual:
{{currentContext}}

Regras de \`partial\`:
- Atualize SOMENTE campos que a mensagem deixa explícitos.
- Preserve correções ("na verdade meu público é X" → targetAudience: X).
- Campos não mencionados ficam null.

Regras de \`reply\`:
- Se \`brandVoice\` está preenchido no perfil, adote esse tom na resposta. Se não, use um tom caloroso e profissional padrão.
- Se a mensagem trouxe informação nova: agradeça citando o que entendeu e peça naturalmente um campo que ainda falta.
- Se o perfil está completo e a pessoa só conversa: responda usando APENAS o que está no perfil. Se ela perguntar algo que não está no perfil, diga que ainda não sabe e ofereça registrar.
- Se a mensagem for fora do tema (piadas, notícias, código, conhecimento geral): redirecione com gentileza para o negócio.
- Nunca invente fatos sobre o negócio. Se não souber, pergunte.`;

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
): Promise<{ partial: PartialSoul; reply: string; usage: Usage }> => {
  const result = await generateObject({
    messages: [{ content: toUserContent(input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    schema: interactionSchema,
    system: renderSystemPrompt(currentContext),
    temperature: 0.2,
  });

  return {
    partial: result.object.partial,
    reply: result.object.reply,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { extractSoul, partialSoulSchema };
export type { AudioInput, Input, PartialSoul, TextInput, Usage };
```

- [ ] **Step 4: Update `apps/api/src/soul/extract.ts`** to propagate `reply`

```ts
import { extractSoul, type Input, type PartialSoul, type Usage } from "../lib/ai";

const extractFromMessage = (
  input: Input,
  currentContext: string,
): Promise<{ partial: PartialSoul; reply: string; usage: Usage }> => extractSoul(input, currentContext);

export { extractFromMessage };
export type { Input, PartialSoul };
```

- [ ] **Step 5: Update `apps/api/src/soul/extract.test.ts`** to assert `reply` propagates

Replace the `stubReturn` helper:

```ts
const stubReturn = (reply: string) =>
  mocked.mockResolvedValue({
    partial: {
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: null,
      whatYouDo: "salão",
    },
    reply,
    usage: { inputTokens: 1, outputTokens: 1 },
  });
```

Update both tests to pass a reply and assert it:

```ts
it("builds a text input from a text message and passes the current context", async () => {
  stubReturn("Anotei!");
  const result = await extractFromMessage(
    { kind: "text", text: "sou um salão" },
    "# Business Context\n\nwhatYouDo: x",
  );
  expect(result.partial.whatYouDo).toBe("salão");
  expect(result.reply).toBe("Anotei!");
  expect(mocked).toHaveBeenCalledWith(
    { kind: "text", text: "sou um salão" },
    "# Business Context\n\nwhatYouDo: x",
  );
});

it("builds an audio input and forwards bytes + mediaType", async () => {
  stubReturn("Recebi seu áudio.");
  const bytes = new Uint8Array([9, 9]);
  const result = await extractFromMessage(
    { bytes, kind: "audio", mediaType: "audio/ogg" },
    "(perfil vazio)",
  );
  expect(result.reply).toBe("Recebi seu áudio.");
  expect(mocked).toHaveBeenCalledWith(
    { bytes, kind: "audio", mediaType: "audio/ogg" },
    "(perfil vazio)",
  );
});
```

- [ ] **Step 6: Run gates — expect green**

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm test
```

All green; test count up by 2 (the new `reply` assertions in ai.test + extract.test count as 0 new tests but the existing tests still pass). Actually no new test files — the existing 41 stay 41 with stronger assertions inside.

- [ ] **Step 7: Verify branch state**

```bash
git branch --show-current   # qolmeia-phase-2-5-conversational-replies
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): lib/ai returns { partial, reply } via fused generateObject

Schema extended with reply: z.string().min(1).max(500).
System prompt rewritten for conversational capture + answer + deflect +
brand-voice mirroring. extract.ts propagates reply through.
Handler not yet using reply (still posts temp inline string from 2.5.1);
flipped in Task 2.5.3."
```

---

## Task 2.5.3: Handler posts LLM-built reply

Flip the handler from the temporary inline string to `result.reply`. Update tests to assert the propagated reply.

**Files:**
- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`

- [ ] **Step 1: Update `apps/api/src/telegram/handler.test.ts`** — RED first

(a) Update `makeDeps` default `extractFromMessage` mock to include `reply`:

```ts
extractFromMessage:
  (over.extractFromMessage ??
  vi.fn().mockResolvedValue({
    partial: {
      brandVoice: null,
      differentiator: null,
      location: null,
      targetAudience: null,
      whatYouDo: "salão",
    },
    reply: "Anotei que vocês são um salão! Qual seu público-alvo?",
    usage: { inputTokens: 1, outputTokens: 1 },
  })) as unknown as HandlerDeps["extractFromMessage"],
```

(b) The "captured/missing summary" test currently asserts:
```ts
expect(thread.post).toHaveBeenCalledWith("Recebi sua mensagem 👋");
```
Replace with:
```ts
expect(thread.post).toHaveBeenCalledWith("Anotei que vocês são um salão! Qual seu público-alvo?");
```

(c) Also update the "audio downloads + forwards bytes" test: it uses `makeDeps()` default, so just assert that `thread.post` was called with the same mocked reply (or with any string from the mock). If the existing test only asserts `expect(fetchData).toHaveBeenCalledOnce()` and `expect(deps.extractFromMessage).toHaveBeenCalledWith(...)`, no change needed.

- [ ] **Step 2: Run tests — expect RED**

`pnpm --filter api exec vitest run src/telegram/handler.test.ts` — expect the "captured/missing summary" test to fail with `thread.post` still receiving `"Recebi sua mensagem 👋"`.

- [ ] **Step 3: Update `apps/api/src/telegram/handler.ts`** — replace temp string with `result.reply` + add log field

Find and remove this constant near the top:

```ts
const TEMP_HAPPY_REPLY = "Recebi sua mensagem 👋";
```

Find this block on the happy path:

```ts
    const { capturedFields } = await applySoulUpdate(link.orgId, result.partial, prisma);

    await thread.post(TEMP_HAPPY_REPLY);

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
```

Replace it with:

```ts
    const { capturedFields } = await applySoulUpdate(link.orgId, result.partial, prisma);

    await thread.post(result.reply);

    logger.info(
      {
        capturedFields,
        chatId: thread.id,
        kind: hasAudio ? "audio" : "text",
        messageId: message.id,
        replyLength: result.reply.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
      },
      "telegram message handled",
    );
```

- [ ] **Step 4: Run tests — expect green**

```bash
pnpm --filter api exec vitest run src/telegram/handler.test.ts
```

Expected: 8/8 handler tests pass (the captured/missing summary test now matches the LLM reply string).

- [ ] **Step 5: Full gates**

```bash
pnpm --filter api typecheck
pnpm --filter api lint
pnpm test
```

All green. Test count unchanged (~41).

- [ ] **Step 6: Verify branch state**

```bash
git branch --show-current   # qolmeia-phase-2-5-conversational-replies
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): handler posts LLM-built reply on happy path

Drop temporary inline TEMP_HAPPY_REPLY introduced in Task 2.5.1.
Happy path now posts result.reply (LLM-generated, brand-voice aware,
deflects off-topic). Add replyLength to the success log line.
Error branches (empty-text, audio-download-fail, extract-fail, top-level
catch) keep their deterministic apologies."
```

---

## Task 2.5.4: Final verification + finishing branch

Mirror Phase 2's wrap. Independent runtime smoke proves the live pipe still 401s on unsigned requests (no live AI call needed in the smoke). Then final whole-impl review subagent. Then invoke finishing-a-development-branch.

- [ ] **Step 1: Full gates from clean**

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

All green. Test count ~41 (was 47 in Phase 2 — we removed 6 deterministic-template tests from reply.test.ts + labels.test.ts).

- [ ] **Step 2: Grep cleanliness**

```bash
grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
grep -rniI portless . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
grep -rn "buildReply\|SOUL_LABELS_PT\|missingSoulFields" apps/api/src 2>&1 | grep -v "docs/superpowers"
```

All three must be empty (no `acme`, no `portless`, no lingering references to the deleted symbols).

- [ ] **Step 3: Seam audit — only one writer + one reader of `businessProfile`**

```bash
grep -rn "businessProfile" apps/api/src
```

Production code (non-test) hits must be exactly `apps/api/src/soul/apply.ts` (writer) and `apps/api/src/soul/knowledge-provider.ts` (reader). Test files mirroring those are acceptable.

- [ ] **Step 4: Runtime smoke**

```bash
docker compose up -d
sleep 2
docker compose ps --format "table {{.Name}}\t{{.Status}}"
(cd apps/api && node dist/index.mjs > /tmp/qolmeia-phase-2-5-smoke.log 2>&1 &)
sleep 4
curl -s localhost:4000/healthz
echo ""
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:4000/telegram/webhook -H 'content-type: application/json' -d '{}'
echo ""
grep -i 'poll' /tmp/qolmeia-phase-2-5-smoke.log || echo "(no poll lines — webhook-only preserved)"
pkill -f "node dist/index.mjs" 2>/dev/null || true
```

Expected:
- `/healthz` returns healthy JSON.
- `POST /telegram/webhook` returns **401** (adapter rejecting unsigned body — proves the route + adapter are wired with the new code).
- No "Telegram polling started" log lines (webhook-only mode preserved).

- [ ] **Step 5: Dispatch final whole-implementation review**

Dispatch the most-capable model (opus) to review Phase 2.5 end-to-end:
- Spec coverage (every spec section maps to a task).
- Module deletions actually happened (reply.ts, labels.ts and tests).
- `SoulProfile` is exactly the 5 new fields, no old field names anywhere.
- `lib/ai` returns `{ partial, reply, usage }`; system prompt has the new content (capture + answer + deflect + brand-voice mirroring rule).
- Handler posts `result.reply` on happy path; error/edge branches unchanged.
- Seam #1 still airtight.
- No secrets in tracked files.

- [ ] **Step 6: Invoke `superpowers:finishing-a-development-branch`**

Present integration options (merge to main locally / push & PR / keep / discard) to the user. Do NOT auto-merge or push.

---

## Self-review (completed during planning)

- **Spec coverage:**
  - §1 locked decisions → Task 2.5.1 (soul fields + DB migration note) + 2.5.2 (model/Gateway/length cap/persona/hallucination guard).
  - §2 module changes (deletions + modifications) → Task 2.5.1 (delete reply/labels, modify soul/apply/handler) + 2.5.2 (modify ai/extract) + 2.5.3 (final handler swap).
  - §3 system prompt → Task 2.5.2 Step 3.
  - §4 Zod schema → Task 2.5.2 Step 3 (`interactionSchema`).
  - §5 flow → Task 2.5.3 Step 3 (`await thread.post(result.reply)`).
  - §6 error/edge branches → all task tasks preserve them; Task 2.5.1 inlines `EMPTY_TEXT_REPLY`.
  - §7 DB migration → no task (no-op).
  - §8 testing → covered in each task's test updates.
  - §9 roadmap → documentation-only; lives in the spec.
  - §10 seams preserved → audited in Task 2.5.4 Step 3.
- **Placeholder scan:** none. Every step has exact code or exact commands.
- **Type consistency:** `PartialSoul` (new 5-field shape) defined in `lib/ai.ts` Step 2.5.2.3, re-exported via `extract.ts` Step 2.5.2.4, consumed by `apply.ts` Step 2.5.1.5. `SoulProfile` (`?:` fields, never `null`) defined in `soul.ts` Step 2.5.1.2 and consumed by `apply.ts`. `extractFromMessage` return type `{ partial; reply; usage }` consistent across `extract.ts` (Step 2.5.2.4) and the `handler.ts` `result.reply` usage (Step 2.5.3.3). The temporary `TEMP_HAPPY_REPLY` is introduced in Task 2.5.1 Step 8 and explicitly removed in Task 2.5.3 Step 3.
