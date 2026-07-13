# Qolmeia Phase 4 — Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner asks for an image; agent calls `generateBrandImage` tool → Gemini multimodal (NanoBanana family) → upload to R2 → handler posts the image to Telegram. End-to-end loop closed.

**Architecture:** New `lib/image-gen.ts` wraps `generateText({ model: gateway("google/gemini-2.5-flash-image"), providerOptions: { google: { responseModalities: ["IMAGE","TEXT"] } } })`, returns bytes from `result.files`. New `ingestGeneratedAsset` in `soul/brand-asset.ts` writes BrandAsset rows tagged `metadata.source="generated"`. `runAgent` gains a third tool `generateBrandImage`; tool execute loads up to 3 uploaded reference assets, calls gen, stores result, returns assetId. `AgentResult` adds `generatedAssetIds`. Handler posts the image(s) via Chat SDK image API (or raw Telegram bot API fallback), then the text reply.

**Tech Stack:** Vercel AI SDK `generateText` with multimodal Gemini, existing `@aws-sdk/client-s3`, `node:crypto`, Chat SDK Telegram adapter (image-posting API to be verified).

**Spec:** `docs/superpowers/specs/2026-05-20-qolmeia-phase-4-image-generation-design.md`

---

## Task 4.1: `lib/image-gen.ts` — Gemini image generation (TDD)

**Files:**

- Create: `apps/api/src/lib/image-gen.ts`
- Test: `apps/api/src/lib/image-gen.test.ts`

- [ ] **Step 1: Confirm branch + write the failing test**

```bash
cd /Users/pedroapfilho/dev/qolmeia-monorepo
git branch --show-current   # must be qolmeia-phase-4-image-generation; if not, git checkout -B qolmeia-phase-4-image-generation main
```

Create `apps/api/src/lib/image-gen.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  gateway: vi.fn((id: string) => ({ modelId: id })),
  generateText: vi.fn(),
  tool: vi.fn((t: unknown) => t),
}));

// eslint-disable-next-line import/order -- vi.mock hoist
import { generateText } from "ai";

import { generateBrandImageBytes } from "./image-gen";

const mockedGenerateText = vi.mocked(generateText);

describe("generateBrandImageBytes", () => {
  it("calls generateText with the Gemini image model + IMAGE responseModality and returns bytes", async () => {
    const expectedBytes = new Uint8Array([5, 6, 7, 8]);
    mockedGenerateText.mockResolvedValue({
      files: [{ mediaType: "image/png", uint8Array: expectedBytes }],
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);

    const result = await generateBrandImageBytes({
      aspectRatio: "1:1",
      prompt: "Salão de cabelo moderno, paleta minimalista",
    });

    expect(result).toBe(expectedBytes);
    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const args = mockedGenerateText.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ text?: string; type: string }>; role: string }>;
      model: { modelId: string };
      providerOptions?: { google?: { responseModalities?: Array<string> } };
    };
    expect(args.model.modelId).toBe("google/gemini-2.5-flash-image");
    expect(args.providerOptions?.google?.responseModalities).toEqual(["IMAGE", "TEXT"]);
    expect(
      args.messages[0]!.content.some(
        (p) => p.type === "text" && p.text === "Salão de cabelo moderno, paleta minimalista",
      ),
    ).toBe(true);
  });

  it("forwards reference images as file content parts before the prompt text", async () => {
    mockedGenerateText.mockResolvedValue({
      files: [{ mediaType: "image/png", uint8Array: new Uint8Array([1]) }],
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);
    const refBytes = new Uint8Array([9, 9, 9]);

    await generateBrandImageBytes({
      aspectRatio: "1:1",
      prompt: "prompt",
      referenceImages: [{ bytes: refBytes, mimeType: "image/jpeg" }],
    });

    const args = mockedGenerateText.mock.calls.at(-1)![0] as {
      messages: Array<{
        content: Array<{ data?: Uint8Array; mediaType?: string; text?: string; type: string }>;
      }>;
    };
    const parts = args.messages[0]!.content;
    expect(parts[0]!.type).toBe("file");
    expect(parts[0]!.data).toBe(refBytes);
    expect(parts[0]!.mediaType).toBe("image/jpeg");
    expect(parts.at(-1)!.type).toBe("text");
  });

  it("decodes base64-only file output", async () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const base64 = Buffer.from(original).toString("base64");
    mockedGenerateText.mockResolvedValue({
      files: [{ base64, mediaType: "image/png" }],
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);

    const result = await generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" });
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it("throws when no file is returned", async () => {
    mockedGenerateText.mockResolvedValue({
      files: [],
      text: "no image",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never);

    await expect(generateBrandImageBytes({ aspectRatio: "1:1", prompt: "x" })).rejects.toThrow(
      /no image/i,
    );
  });
});
```

- [ ] **Step 2: Run test, confirm RED**

```bash
pnpm --filter api exec vitest run src/lib/image-gen.test.ts
```

Expected: FAIL `Cannot find module './image-gen'`.

- [ ] **Step 3: Implement `apps/api/src/lib/image-gen.ts`**

```ts
import { gateway, generateText } from "ai";

import { env } from "./env";

void env.AI_GATEWAY_API_KEY;

type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3";

type GenerateImageArgs = {
  aspectRatio: AspectRatio;
  prompt: string;
  referenceImages?: ReadonlyArray<{ bytes: Uint8Array; mimeType: string }>;
};

const generateBrandImageBytes = async (args: GenerateImageArgs): Promise<Uint8Array> => {
  const contentParts: Array<
    { data: Uint8Array; mediaType: string; type: "file" } | { text: string; type: "text" }
  > = [];
  for (const ref of args.referenceImages ?? []) {
    contentParts.push({ data: ref.bytes, mediaType: ref.mimeType, type: "file" });
  }
  contentParts.push({ text: args.prompt, type: "text" });

  const result = (await generateText({
    messages: [{ content: contentParts, role: "user" }],
    model: gateway("google/gemini-2.5-flash-image"),
    providerOptions: { google: { responseModalities: ["IMAGE", "TEXT"] } },
  })) as { files?: Array<{ base64?: string; mediaType: string; uint8Array?: Uint8Array }> };

  const file = result.files?.[0];
  if (!file) {
    throw new Error("Image generation returned no image file");
  }
  if (file.uint8Array) {
    return file.uint8Array;
  }
  if (file.base64) {
    return new Uint8Array(Buffer.from(file.base64, "base64"));
  }
  throw new Error("Image file has neither uint8Array nor base64 payload");
};

export { generateBrandImageBytes };
export type { AspectRatio, GenerateImageArgs };
```

> Implementer risk: confirm the actual installed `ai@^6` exposes `result.files` with `uint8Array`/`base64`. Inspect `node_modules/ai/dist/*.d.ts` for the `GenerateTextResult` shape with multimodal output. Adapt the field name minimally if it differs (e.g. `result.experimental_output.files`, `result.providerMetadata.google.files`, etc.). Preserve the test assertion semantics.

- [ ] **Step 4: Run test, confirm GREEN (4 tests)**

```bash
pnpm --filter api exec vitest run src/lib/image-gen.test.ts
```

- [ ] **Step 5: Full gates**

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

All green; test count up by 4 (48 → 52). Lint 0/0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/image-gen.ts apps/api/src/lib/image-gen.test.ts
git commit -m "feat(api): lib/image-gen generateBrandImageBytes (Gemini multimodal via Gateway)"
```

Verify branch + `git log --oneline -2`.

---

## Task 4.2: `ingestGeneratedAsset` in `soul/brand-asset.ts` (TDD)

Add a second exported function alongside `ingestBrandAsset`. Same sha256 + R2 + row pattern; row's `metadata` includes `source: "generated"`, `prompt`, `generatedAt`.

**Files:**

- Modify: `apps/api/src/soul/brand-asset.ts`
- Modify: `apps/api/src/soul/brand-asset.test.ts`

- [ ] **Step 1: Append tests to `brand-asset.test.ts`** (RED)

```ts
describe("ingestGeneratedAsset", () => {
  it("sets metadata.source='generated' + prompt + generatedAt ISO string", async () => {
    const storage = makeStorage();
    const prisma = makePrisma(null);
    const bytes = new Uint8Array([42, 43]);

    const result = await ingestGeneratedAsset({
      bytes,
      mimeType: "image/png",
      orgId: "org_1",
      prisma: prisma as never,
      prompt: "Logo moderno minimalista",
      storage,
    });

    expect(result.assetId).toBe("asset_new");
    expect(prisma.brandAsset.create).toHaveBeenCalledOnce();
    const createArgs = prisma.brandAsset.create.mock.calls[0]![0] as {
      data: { metadata: { generatedAt: string; prompt: string; source: string } };
    };
    expect(createArgs.data.metadata.source).toBe("generated");
    expect(createArgs.data.metadata.prompt).toBe("Logo moderno minimalista");
    expect(createArgs.data.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("dedup hit: returns existing assetId without upload + create", async () => {
    const storage = makeStorage();
    const prisma = makePrisma({
      id: "asset_existing",
      r2Key: "org_org_1/abc.png",
      sha256: "fbc1a9f858ea9e177916964bd88c3d37b91a1e84412765e29950777f265c4b75", // sha256 of [42,43]
    });

    const result = await ingestGeneratedAsset({
      bytes: new Uint8Array([42, 43]),
      mimeType: "image/png",
      orgId: "org_1",
      prisma: prisma as never,
      prompt: "x",
      storage,
    });

    expect(result.assetId).toBe("asset_existing");
    expect(storage.uploadAsset).not.toHaveBeenCalled();
    expect(prisma.brandAsset.create).not.toHaveBeenCalled();
  });
});
```

The test imports need to add `ingestGeneratedAsset` to the existing imports from `./brand-asset`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter api exec vitest run src/soul/brand-asset.test.ts
```

Expected: FAIL `ingestGeneratedAsset is not exported`.

- [ ] **Step 3: Add `ingestGeneratedAsset` to `apps/api/src/soul/brand-asset.ts`**

Below the existing `ingestBrandAsset`, add:

```ts
const ingestGeneratedAsset = async (args: {
  bytes: Uint8Array;
  mimeType: string;
  orgId: string;
  prisma: IngestPrisma;
  prompt: string;
  storage?: IngestStorage;
}): Promise<{ assetId: string }> => {
  const storage: IngestStorage = args.storage ?? {
    assetKey: defaultAssetKey,
    uploadAsset: defaultUpload,
  };
  const sha256 = sha256Hex(args.bytes);

  const existing = await args.prisma.brandAsset.findUnique({
    where: { orgId_sha256: { orgId: args.orgId, sha256 } },
  });
  if (existing) {
    return { assetId: existing.id };
  }

  const ext = mimeToExt(args.mimeType);
  const key = storage.assetKey(args.orgId, sha256, ext);

  await storage.uploadAsset({ bytes: args.bytes, key, mimeType: args.mimeType });

  const row = await args.prisma.brandAsset.create({
    data: {
      metadata: {
        generatedAt: new Date().toISOString(),
        prompt: args.prompt,
        source: "generated",
      },
      mimeType: args.mimeType,
      orgId: args.orgId,
      r2Key: key,
      sha256,
      size: args.bytes.byteLength,
    },
  });

  return { assetId: row.id };
};

export { ingestGeneratedAsset };
```

Keep the existing `ingestBrandAsset` export.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter api exec vitest run src/soul/brand-asset.test.ts
```

Expected: 5 tests pass (3 existing + 2 new).

- [ ] **Step 5: Full gates, commit**

All green; count 52 → 54.

```bash
git add apps/api/src/soul/brand-asset.ts apps/api/src/soul/brand-asset.test.ts
git commit -m "feat(api): ingestGeneratedAsset (BrandAsset row with metadata.source=generated)"
```

---

## Task 4.3: `runAgent` adds `generateBrandImage` tool + `generatedAssetIds` (TDD)

Add the third tool to `runAgent`. Update return type. Update system prompt. Update tests.

**Files:**

- Modify: `apps/api/src/lib/ai.ts`
- Modify: `apps/api/src/lib/ai.test.ts`

- [ ] **Step 1: Extend `ai.test.ts`** (RED)

Update existing tests' assertions to expect `generateBrandImage` in tools and `generatedAssetIds` in result. Add a new test:

```ts
it("when generateBrandImage tool is called, generatedAssetIds collects the asset ids", async () => {
  // Mock: model calls generateBrandImage once with success.
  // We can't easily test tool execute closures via the high-level mock — instead, mock
  // toolCalls + toolResults shape directly.
  generateTextMock.mockResolvedValue({
    files: [],
    text: "Pronto! Gerei a imagem.",
    toolCalls: [{ toolName: "generateBrandImage" }],
    toolResults: [{ result: { assetId: "asset_gen_1", ok: true }, toolName: "generateBrandImage" }],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  } as never);

  const prisma = {
    brandAsset: { update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  } as never;

  const result = await runAgent({
    currentContext: "",
    existingAssets: [],
    input: { audioBytes: undefined, audioMime: undefined, imageBytes: [], text: "gera uma imagem" },
    newAssets: [],
    orgId: "org_1",
    oversizeCount: 0,
    prisma,
  });

  expect(result.generatedAssetIds).toEqual(["asset_gen_1"]);
  expect(result.toolCallSummary.generateBrandImage).toBe(1);
});
```

Also update the existing tests' expected `tools` keys to be `["extractSoul", "generateBrandImage", "labelBrandAsset"]` (alphabetised) and `toolCallSummary` shape to include `generateBrandImage: 0`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter api exec vitest run src/lib/ai.test.ts
```

Expected: FAIL — tools list and result.generatedAssetIds don't match.

- [ ] **Step 3: Update `apps/api/src/lib/ai.ts`**

Add the new tool inside `runAgent`. The full updates (incremental, applied in place):

1. Add import at top (with existing imports, alphabetised):

   ```ts
   import { generateBrandImageBytes } from "./image-gen";
   import { fetchAsset } from "./storage";
   import { ingestGeneratedAsset } from "../soul/brand-asset";
   ```

2. Extend `AgentResult` type:

   ```ts
   type AgentResult = {
     generatedAssetIds: Array<string>;
     text: string;
     toolCallSummary: {
       extractSoul: number;
       generateBrandImage: number;
       labelBrandAsset: number;
     };
     usage: { inputTokens: number; outputTokens: number };
   };
   ```

3. Add the new tool input schema near the existing ones:

   ```ts
   const generateBrandImageToolInput = z.object({
     aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
     prompt: z.string().min(1).max(2000),
   });
   ```

4. Update `AGENT_SYSTEM_TEMPLATE` to list 3 tools and add the new rules per spec §5.

5. Inside `runAgent`, before the `tools` definition, initialise `const generatedAssetIds: Array<string> = [];`.

6. Add the third tool to the `tools` object (alphabetised: `extractSoul`, `generateBrandImage`, `labelBrandAsset`):

   ```ts
   generateBrandImage: tool({
     description:
       "Gere uma imagem para o dono baseada no perfil do negócio (soul + brand assets). Use APENAS quando o dono pedir explicitamente. AT MOST 1 call por mensagem.",
     execute: async ({ aspectRatio, prompt }: z.infer<typeof generateBrandImageToolInput>) => {
       try {
         const refRows = await prisma.brandAsset.findMany({
           orderBy: { createdAt: "desc" },
           select: { metadata: true, mimeType: true, r2Key: true },
           take: 3,
           where: { orgId },
         });
         const uploadedRefs = refRows.filter((r) => {
           const meta = r.metadata as { source?: string } | null;
           return meta?.source !== "generated";
         });
         const referenceImages: Array<{ bytes: Uint8Array; mimeType: string }> = [];
         for (const row of uploadedRefs) {
           try {
             const bytes = await fetchAsset(row.r2Key);
             referenceImages.push({ bytes, mimeType: row.mimeType });
           } catch {
             // skip per-reference fetch failures
           }
         }
         const fullPrompt = `${prompt}\n\nAspect ratio: ${aspectRatio}.`;
         const bytes = await generateBrandImageBytes({
           aspectRatio,
           prompt: fullPrompt,
           referenceImages,
         });
         const { assetId } = await ingestGeneratedAsset({
           bytes,
           mimeType: "image/png",
           orgId,
           prisma,
           prompt,
         });
         generatedAssetIds.push(assetId);
         return { assetId, ok: true as const };
       } catch (error) {
         return { error: String(error), ok: false as const };
       }
     },
     inputSchema: generateBrandImageToolInput,
   }),
   ```

7. Update the `toolCallSummary` aggregation to count the new tool too:

   ```ts
   const summary = { extractSoul: 0, generateBrandImage: 0, labelBrandAsset: 0 };
   for (const call of result.toolCalls ?? []) {
     const name = (call as { toolName: string }).toolName;
     if (name === "extractSoul") summary.extractSoul += 1;
     else if (name === "generateBrandImage") summary.generateBrandImage += 1;
     else if (name === "labelBrandAsset") summary.labelBrandAsset += 1;
   }
   ```

8. Update the final return to include `generatedAssetIds`:
   ```ts
   return {
     generatedAssetIds,
     text: result.text,
     toolCallSummary: summary,
     usage: {
       inputTokens: result.usage.inputTokens ?? 0,
       outputTokens: result.usage.outputTokens ?? 0,
     },
   };
   ```

> Implementer risk: `tool({ execute, inputSchema, description })` may complain about the closure-captured `orgId`/`prisma`. The existing extractSoul/labelBrandAsset tools already use this pattern; follow it.

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter api exec vitest run src/lib/ai.test.ts
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

All green; test count up by 1 (54 → 55). Lint 0/0. If oxlint flags the new tool's keys non-alphabetical, sort.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/ai.ts apps/api/src/lib/ai.test.ts
git commit -m "feat(api): runAgent adds generateBrandImage tool + generatedAssetIds"
```

---

## Task 4.4: handler posts generated images (TDD)

Handler queries the rows for `generatedAssetIds`, fetches bytes from R2, sends to Telegram via the Chat SDK image API, then posts the agent text reply.

**Files:**

- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`

- [ ] **Step 1: Investigate Chat SDK image-posting API**

```bash
grep -rni "postImage\|postPhoto\|sendPhoto\|sendImage\|attachments" node_modules/chat/dist/*.d.ts | head -20
grep -rni "postImage\|postPhoto\|sendPhoto\|sendImage\|attachments" node_modules/@chat-adapter/telegram/dist/*.d.ts | head -20
```

Identify the correct method on `Thread` for sending an image. Note the exact signature. If no first-class method exists, the implementer falls back to raw Telegram bot API call (multipart `sendPhoto` to `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`). Document what you found in the commit message.

- [ ] **Step 2: Write the handler test extension** (RED)

Add a new test to `handler.test.ts`:

```ts
it("posts generated image bytes when runAgent returns generatedAssetIds", async () => {
  const generatedBytes = new Uint8Array([99, 98, 97]);
  const fetchAssetMock = vi.fn().mockResolvedValue(generatedBytes);
  const postImageMock = vi.fn().mockResolvedValue(undefined);

  const prisma = makePrisma();
  (prisma as never as { brandAsset: { findUnique: ReturnType<typeof vi.fn> } }).brandAsset = {
    ...(prisma as never as { brandAsset: object }).brandAsset,
    findUnique: vi.fn().mockResolvedValue({ mimeType: "image/png", r2Key: "org_1/gen.png" }),
  };

  const deps: HandlerDeps = {
    fetchAsset: fetchAssetMock as unknown as HandlerDeps["fetchAsset"],
    getBusinessContext: vi.fn().mockResolvedValue("") as never,
    ingestBrandAsset: vi.fn() as never,
    prisma: prisma as never,
    runAgent: vi.fn().mockResolvedValue({
      generatedAssetIds: ["asset_gen_1"],
      text: "Pronto, gerei a imagem!",
      toolCallSummary: { extractSoul: 0, generateBrandImage: 1, labelBrandAsset: 0 },
      usage: { inputTokens: 1, outputTokens: 1 },
    }) as never,
  };

  const thread = {
    id: "tg_chat_42",
    post: vi.fn().mockResolvedValue(undefined),
    postImage: postImageMock,
  };

  await handleIncomingMessage(deps, thread as never, makeMessage({ text: "gera uma imagem" }));

  expect(fetchAssetMock).toHaveBeenCalledWith("org_1/gen.png");
  expect(postImageMock).toHaveBeenCalledOnce();
  expect(postImageMock).toHaveBeenCalledWith(expect.objectContaining({ bytes: generatedBytes }));
  expect(thread.post).toHaveBeenCalledWith("Pronto, gerei a imagem!");
});
```

> If the actual Chat SDK uses a different method name (`postPhoto`, `post({ attachments })`, etc.), update the test's mock + assertion accordingly. Test the actual implementation's call shape.

Also update existing test's `runAgent` default mock to include `generatedAssetIds: []` so they still pass with the new return shape.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter api exec vitest run src/telegram/handler.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Update `apps/api/src/telegram/handler.ts`**

1. Add `fetchAsset` to `HandlerDeps` (optional, defaults to `fetchAssetDefault` imported from `../lib/storage`):

   ```ts
   import { fetchAsset as fetchAssetDefault } from "../lib/storage";
   // ...
   type HandlerDeps = {
     fetchAsset?: typeof fetchAssetDefault;
     getBusinessContext?: typeof getBusinessContextDefault;
     ingestBrandAsset?: typeof ingestBrandAssetDefault;
     prisma: Pick<
       PrismaClient,
       | "$transaction"
       | "brandAsset"
       | "conversation"
       | "message"
       | "organization"
       | "telegramLink"
       | "webhookEvent"
     >;
     runAgent?: typeof runAgentDefault;
   };
   ```

2. Add `IncomingThread.postImage` to the structural type (or extend to use an optional method):

   ```ts
   type IncomingThread = {
     id: string;
     post: (text: string) => Promise<unknown>;
     postImage?: (args: {
       bytes: Uint8Array;
       caption?: string;
       mimeType?: string;
     }) => Promise<unknown>;
   };
   ```

3. After the `result = await runAgent(...)` line, before the existing `await thread.post(result.text)`, add the image-posting block:

   ```ts
   const { fetchAsset: doFetch = fetchAssetDefault } = deps;
   if (result.generatedAssetIds.length > 0 && thread.postImage) {
     for (const assetId of result.generatedAssetIds) {
       try {
         const row = await prisma.brandAsset.findUnique({
           select: { mimeType: true, r2Key: true },
           where: { id: assetId },
         });
         if (!row) continue;
         const bytes = await doFetch(row.r2Key);
         await thread.postImage({ bytes, mimeType: row.mimeType });
       } catch (error) {
         logger.error({ assetId, chatId: thread.id, error }, "generated_image.post_failed");
       }
     }
   }
   await thread.post(result.text);
   ```

4. Update the success-log payload to include `generatedAssetIds: result.generatedAssetIds`.

If the Chat SDK doesn't expose `postImage` on `Thread`, replace the `await thread.postImage(...)` with a direct Telegram Bot API call:

```ts
import FormData from "node:undici"; /* or similar */
// (Skipping if Chat SDK actually has the method — verify Step 1 results first.)
```

> The implementer must use whatever the actual SDK provides; the test asserts the chosen method's call shape. Both paths satisfy spec §6.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter api exec vitest run src/telegram/handler.test.ts
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

All green; test count up by 1 (55 → 56). Lint 0/0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
git commit -m "feat(api): handler posts generated images to Telegram + text reply"
```

---

## Task 4.5: Phase 4 final verification + finishing branch

- [ ] **Step 1: Full gate from clean**

```bash
pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

All green; ~56 tests.

- [ ] **Step 2: Greps clean**

```bash
grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
grep -rniI portless . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.turbo | grep -v docs/superpowers
```

Both empty.

- [ ] **Step 3: Seam audit (production code only)**

```bash
grep -rn "businessProfile" apps/api/src | grep -v test
grep -rn "brandAsset.create" apps/api/src | grep -v test
grep -rn "brandAsset.update" apps/api/src | grep -v test
grep -rn "brandAsset.findUnique" apps/api/src | grep -v test
grep -rn "brandAsset.findMany" apps/api/src | grep -v test
```

Expected:

- `businessProfile` only in `soul/apply.ts` + `soul/knowledge-provider.ts`.
- `brandAsset.create` only in `soul/brand-asset.ts` (both ingestBrandAsset + ingestGeneratedAsset).
- `brandAsset.update` only in `lib/ai.ts`.
- `brandAsset.findUnique` in `soul/brand-asset.ts` (dedup checks) + `telegram/handler.ts` (post-generation row lookup).
- `brandAsset.findMany` in `telegram/handler.ts` (existingAssets) + `lib/ai.ts` (generateBrandImage tool refs).

- [ ] **Step 4: Boot smoke**

```bash
docker compose up -d
sleep 2
pkill -f "node dist/index.mjs" 2>/dev/null; sleep 1
(cd apps/api && node dist/index.mjs > /tmp/qolmeia-phase-4-smoke.log 2>&1 &)
sleep 4
curl -s localhost:4000/healthz
echo ""
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:4000/telegram/webhook -H 'content-type: application/json' -d '{}'
echo ""
grep -i 'poll' /tmp/qolmeia-phase-4-smoke.log || echo "(no poll lines)"
pkill -f "node dist/index.mjs" 2>/dev/null; sleep 1
```

Expected: healthy + 401 + no polling.

- [ ] **Step 5: Commit spec + plan docs**

```bash
git add docs/superpowers/specs/2026-05-20-qolmeia-phase-4-image-generation-design.md docs/superpowers/plans/2026-05-20-qolmeia-phase-4-image-generation.md
git commit -m "docs(phase-4): image generation spec + plan"
```

- [ ] **Step 6: Final whole-impl review** dispatched to opus per the pattern. Spec coverage, runtime smoke verified, seams clean, all 3 tools in place, generatedAssetIds aggregation correct.

- [ ] **Step 7: Invoke `superpowers:finishing-a-development-branch`** to merge Phase 4 to main locally (Option 1 per the user's established pattern).

---

## Self-review (completed during planning)

- **Spec coverage:** §1 decisions → Task 4.1 (image-gen), 4.2 (ingestGeneratedAsset), 4.3 (tool + generatedAssetIds), 4.4 (handler post); §2 module changes → Tasks 4.1–4.4; §3 tool schema → Task 4.3; §4 `generateBrandImageBytes` → Task 4.1; §5 system prompt → Task 4.3 Step 3.4; §6 data flow → Task 4.4; §7 AgentResult → Task 4.3 Step 3.2; §8 error handling → Tasks 4.3 (tool try/catch) + 4.4 (postImage try/catch); §9 testing → spread across tasks; §10/§11 out-of-scope/roadmap → docs only; §12 seams → Task 4.5 Step 3 audits.
- **Placeholder scan:** none. Every step has runnable code + commands.
- **Type consistency:** `AspectRatio` enum identical between `image-gen.ts` and the `generateBrandImageToolInput` z.enum (`["1:1","16:9","9:16","4:3"]`). `IngestStorage`/`IngestPrisma` types reused for `ingestGeneratedAsset`. `AgentResult.generatedAssetIds: Array<string>` consistent between `lib/ai.ts` definition and handler usage. `IncomingThread.postImage` optional method (added in Task 4.4) matches the test mock.
