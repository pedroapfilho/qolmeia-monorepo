# Qolmeia Phase 3 — R2 Brand Assets + Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram images → R2 + brand metadata via vision; switch the AI seam from `generateObject` to a `generateText` agent loop with two tools (`extractSoul`, `labelBrandAsset`); rename `extractFromMessage`→`runAgent`.

**Architecture:** New `lib/storage.ts` (S3 client) + `soul/brand-asset.ts` (SHA-256 dedup + R2 upload + row create). New Prisma `BrandAsset` model. `lib/ai.ts` switches to `generateText({ tools, stopWhen: stepCountIs(5) })`; tools close over `orgId`/`prisma` and execute side effects directly (`applySoulUpdate` for soul; row update for brand metadata). Handler pre-processes image attachments before the agent loop, then posts the agent's final `text`.

**Tech Stack:** `@aws-sdk/client-s3` for R2, `node:crypto` for SHA-256, Vercel AI SDK `generateText({ tools, stopWhen })` via gateway, Zod tool input schemas, Prisma 7.

**Spec:** `docs/superpowers/specs/2026-05-20-qolmeia-phase-3-r2-brand-assets-design.md`

---

## Task 3.1: Foundation — deps, env promotion, Prisma model

Add `@aws-sdk/client-s3` dependency, promote 6 `R2_*` env vars from optional to required, add Prisma `BrandAsset` model + back-relation, `db:push` to local docker. All groundwork before any feature code — gates stay green because nothing references the new model yet.

**Files:**
- Modify: `apps/api/package.json` (add dep)
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/lib/env.test.ts`
- Modify: `apps/api/src/lib/vitest-setup.ts`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Confirm branch + install dep**

```bash
cd /Users/pedroapfilho/dev/qolmeia-monorepo
git branch --show-current   # must be qolmeia-phase-3-r2-brand-assets; if not, git checkout -B qolmeia-phase-3-r2-brand-assets main
pnpm --filter api add @aws-sdk/client-s3
```

Verify `npm view @aws-sdk/client-s3 repository` shows `github.com/aws/aws-sdk-js-v3` (the official AWS SDK).

- [ ] **Step 2: Promote `R2_*` to required in `apps/api/src/lib/env.ts`**

Replace lines for each R2_* var:
```ts
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.string().min(1),
  R2_REGION: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
```

(Keep them alphabetically among the other keys.)

- [ ] **Step 3: Update `apps/api/src/lib/vitest-setup.ts`**

Append:
```ts
vi.stubEnv("R2_ACCESS_KEY_ID", "test-r2-key");
vi.stubEnv("R2_ACCOUNT_ID", "test-account");
vi.stubEnv("R2_BUCKET", "test-bucket");
vi.stubEnv("R2_ENDPOINT", "https://test.r2.cloudflarestorage.com");
vi.stubEnv("R2_REGION", "auto");
vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-r2-secret");
```

- [ ] **Step 4: Update `apps/api/src/lib/env.test.ts` base**

Add the 6 keys to the `base` object so the "valid minimal env" test parses:
```ts
const base = {
  AI_GATEWAY_API_KEY: "test-key",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  R2_ACCESS_KEY_ID: "test-r2-key",
  R2_ACCOUNT_ID: "test-account",
  R2_BUCKET: "test-bucket",
  R2_ENDPOINT: "https://test.r2.cloudflarestorage.com",
  R2_REGION: "auto",
  R2_SECRET_ACCESS_KEY: "test-r2-secret",
  REDIS_URL: "redis://localhost:6379",
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_BOT_USERNAME: "qolmeia_bot",
  TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret",
};
```

If the existing "rejects when required var missing" test destructures `REDIS_URL`, no change needed; the schema parses for the present case.

- [ ] **Step 5: Add `BrandAsset` to `packages/db/prisma/schema.prisma`**

Append the model (after `WebhookEvent`):
```prisma
model BrandAsset {
  id        String   @id @default(cuid())
  orgId     String
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  r2Key     String
  sha256    String
  mimeType  String
  size      Int
  metadata  Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orgId, sha256])
  @@index([orgId, createdAt])
}
```

Add `brandAssets BrandAsset[]` to the `Organization` model's relation block.

- [ ] **Step 6: Generate client + push to LOCAL docker**

```bash
pnpm db:generate
pnpm db:push
```

Verify the printed `Datasource "db"` URL is `localhost:5436` (NOT Railway). The schema sync should be a non-destructive add (only a new table + a new index).

- [ ] **Step 7: Full gates green**

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

Expected: all green; 41 tests still pass (no new tests yet).

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/lib/env.ts apps/api/src/lib/env.test.ts apps/api/src/lib/vitest-setup.ts packages/db/prisma/schema.prisma
git commit -m "feat(db,api): BrandAsset model + R2_* env required + @aws-sdk/client-s3 dep"
```

Verify: `git branch --show-current` returns `qolmeia-phase-3-r2-brand-assets`. `git log --oneline -2` shows the commit on top of `7b88268`.

---

## Task 3.2: `lib/storage.ts` — R2 S3 client (TDD)

Thin wrapper around `@aws-sdk/client-s3` configured for Cloudflare R2. Exports `uploadAsset`, `assetKey`, `fetchAsset`.

**Files:**
- Create: `apps/api/src/lib/storage.ts`
- Test: `apps/api/src/lib/storage.test.ts`

- [ ] **Step 1: Write the failing test `storage.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: vi.fn().mockImplementation((args: unknown) => ({ args, type: "GET" })),
  PutObjectCommand: vi.fn().mockImplementation((args: unknown) => ({ args, type: "PUT" })),
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
}));

// eslint-disable-next-line import/order -- vi.mock must precede import of module under test
import { assetKey, fetchAsset, uploadAsset } from "./storage";

describe("assetKey", () => {
  it("builds a deterministic per-org key from sha256 + ext", () => {
    expect(assetKey("org_1", "abc123", "jpg")).toBe("org_org_1/abc123.jpg");
  });

  it("strips a leading dot from the extension", () => {
    expect(assetKey("org_1", "abc123", ".png")).toBe("org_org_1/abc123.png");
  });
});

describe("uploadAsset", () => {
  it("sends a PutObjectCommand with bucket, key, body, content-type", async () => {
    sendMock.mockResolvedValue({});
    const bytes = new Uint8Array([1, 2, 3]);

    await uploadAsset({ bytes, key: "org_1/abc.jpg", mimeType: "image/jpeg" });

    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = sendMock.mock.calls[0]![0] as { args: { Body: Uint8Array; Bucket: string; ContentType: string; Key: string }; type: string };
    expect(cmd.type).toBe("PUT");
    expect(cmd.args.Bucket).toBe("test-bucket");
    expect(cmd.args.Key).toBe("org_1/abc.jpg");
    expect(cmd.args.Body).toBe(bytes);
    expect(cmd.args.ContentType).toBe("image/jpeg");
  });
});

describe("fetchAsset", () => {
  it("returns the bytes from a GetObjectCommand response", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => bytes },
    });

    const result = await fetchAsset("org_1/abc.jpg");

    const cmd = sendMock.mock.calls.at(-1)![0] as { args: { Bucket: string; Key: string }; type: string };
    expect(cmd.type).toBe("GET");
    expect(cmd.args.Bucket).toBe("test-bucket");
    expect(cmd.args.Key).toBe("org_1/abc.jpg");
    expect(result).toBe(bytes);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter api exec vitest run src/lib/storage.test.ts
```
Expected: FAIL `Cannot find module './storage'`.

- [ ] **Step 3: Implement `apps/api/src/lib/storage.ts`**

```ts
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";

const client = new S3Client({
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  endpoint: env.R2_ENDPOINT,
  region: env.R2_REGION,
});

const assetKey = (orgId: string, sha256: string, ext: string): string => {
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  return `org_${orgId}/${sha256}.${cleanExt}`;
};

const uploadAsset = async (args: {
  bytes: Uint8Array;
  key: string;
  mimeType: string;
}): Promise<void> => {
  await client.send(
    new PutObjectCommand({
      Body: args.bytes,
      Bucket: env.R2_BUCKET,
      ContentType: args.mimeType,
      Key: args.key,
    }),
  );
};

const fetchAsset = async (key: string): Promise<Uint8Array> => {
  const result = (await client.send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
  )) as { Body?: { transformToByteArray: () => Promise<Uint8Array> } };
  if (!result.Body) {
    throw new Error(`R2 fetch returned no body for key ${key}`);
  }
  return result.Body.transformToByteArray();
};

export { assetKey, fetchAsset, uploadAsset };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter api exec vitest run src/lib/storage.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Full gates**

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

All green; test count up by 4 (41 → 45). Apply alphabetical key sorting if perfectionist complains; no disable comments.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/storage.ts apps/api/src/lib/storage.test.ts
git commit -m "feat(api): lib/storage R2 client (uploadAsset, assetKey, fetchAsset)"
```

---

## Task 3.3: `soul/brand-asset.ts` — `ingestBrandAsset` (TDD)

Deterministic asset ingest: SHA-256 → dedup check → R2 upload (skip if dup) → `BrandAsset` row creation with empty metadata. Returns `{ assetId, deduped }`.

**Files:**
- Create: `apps/api/src/soul/brand-asset.ts`
- Test: `apps/api/src/soul/brand-asset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { ingestBrandAsset, type IngestStorage } from "./brand-asset";

const makeStorage = (): IngestStorage => ({
  assetKey: vi.fn((orgId: string, sha256: string, ext: string) => `org_${orgId}/${sha256}.${ext}`),
  uploadAsset: vi.fn().mockResolvedValue(undefined),
});

const makePrisma = (existing: { id: string; r2Key: string; sha256: string } | null) => ({
  brandAsset: {
    create: vi.fn().mockImplementation(({ data }: { data: { sha256: string } }) =>
      Promise.resolve({ id: "asset_new", r2Key: `org_org_1/${data.sha256}.jpg`, sha256: data.sha256 }),
    ),
    findUnique: vi.fn().mockResolvedValue(existing),
  },
});

describe("ingestBrandAsset", () => {
  it("computes SHA-256, uploads to R2, and creates a row on first upload", async () => {
    const storage = makeStorage();
    const prisma = makePrisma(null);
    const bytes = new Uint8Array([1, 2, 3]);

    const result = await ingestBrandAsset({
      bytes,
      mimeType: "image/jpeg",
      orgId: "org_1",
      prisma: prisma as never,
      storage,
    });

    expect(result.deduped).toBe(false);
    expect(result.assetId).toBe("asset_new");
    expect(storage.uploadAsset).toHaveBeenCalledOnce();
    expect(prisma.brandAsset.create).toHaveBeenCalledOnce();

    // Verify SHA-256 of [1,2,3] = 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81
    const createArgs = prisma.brandAsset.create.mock.calls[0]![0] as { data: { sha256: string } };
    expect(createArgs.data.sha256).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("skips upload + create on dedup hit (same sha256 already in org)", async () => {
    const storage = makeStorage();
    const prisma = makePrisma({
      id: "asset_existing",
      r2Key: "org_org_1/abc.jpg",
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    const bytes = new Uint8Array([1, 2, 3]);

    const result = await ingestBrandAsset({
      bytes,
      mimeType: "image/jpeg",
      orgId: "org_1",
      prisma: prisma as never,
      storage,
    });

    expect(result.deduped).toBe(true);
    expect(result.assetId).toBe("asset_existing");
    expect(storage.uploadAsset).not.toHaveBeenCalled();
    expect(prisma.brandAsset.create).not.toHaveBeenCalled();
  });

  it("derives extension from mimeType for the R2 key", async () => {
    const storage = makeStorage();
    const prisma = makePrisma(null);

    await ingestBrandAsset({
      bytes: new Uint8Array([9]),
      mimeType: "image/png",
      orgId: "org_1",
      prisma: prisma as never,
      storage,
    });

    expect(storage.assetKey).toHaveBeenCalledWith("org_1", expect.any(String), "png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter api exec vitest run src/soul/brand-asset.test.ts
```
Expected: FAIL `Cannot find module './brand-asset'`.

- [ ] **Step 3: Implement `apps/api/src/soul/brand-asset.ts`**

```ts
import { createHash } from "node:crypto";

import type { PrismaClient } from "@repo/db";

import { assetKey as defaultAssetKey, uploadAsset as defaultUpload } from "../lib/storage";

type IngestStorage = {
  assetKey: typeof defaultAssetKey;
  uploadAsset: typeof defaultUpload;
};

type IngestPrisma = Pick<PrismaClient, "brandAsset">;

const mimeToExt = (mimeType: string): string => {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/heic") return "heic";
  return "bin";
};

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const ingestBrandAsset = async (args: {
  bytes: Uint8Array;
  mimeType: string;
  orgId: string;
  prisma: IngestPrisma;
  storage?: IngestStorage;
}): Promise<{ assetId: string; deduped: boolean }> => {
  const storage: IngestStorage = args.storage ?? {
    assetKey: defaultAssetKey,
    uploadAsset: defaultUpload,
  };
  const sha256 = sha256Hex(args.bytes);

  const existing = await args.prisma.brandAsset.findUnique({
    where: { orgId_sha256: { orgId: args.orgId, sha256 } },
  });
  if (existing) {
    return { assetId: existing.id, deduped: true };
  }

  const ext = mimeToExt(args.mimeType);
  const key = storage.assetKey(args.orgId, sha256, ext);

  await storage.uploadAsset({ bytes: args.bytes, key, mimeType: args.mimeType });

  const row = await args.prisma.brandAsset.create({
    data: {
      metadata: {},
      mimeType: args.mimeType,
      orgId: args.orgId,
      r2Key: key,
      sha256,
      size: args.bytes.byteLength,
    },
  });

  return { assetId: row.id, deduped: false };
};

export { ingestBrandAsset };
export type { IngestPrisma, IngestStorage };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter api exec vitest run src/soul/brand-asset.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Full gates**

All green; test count up by 3 (45 → 48). Lint must be 0/0; if oxlint complains about keys or `await` patterns, restructure minimally.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/soul/brand-asset.ts apps/api/src/soul/brand-asset.test.ts
git commit -m "feat(api): ingestBrandAsset (sha256 dedup + R2 upload + row create)"
```

---

## Task 3.4: `lib/ai.ts` adds `runAgent` (parallel to `extractSoul`) + tools (TDD)

Add a NEW `runAgent` function alongside the existing Phase 2.5 `extractSoul`. Uses `generateText({ tools, stopWhen: stepCountIs(5) })`. Defines `extractSoul`/`labelBrandAsset` as tools that close over `orgId`/`prisma`. Keeps Phase 2.5's `extractSoul` function alive (handler will swap in Task 3.5).

**Files:**
- Modify: `apps/api/src/lib/ai.ts`
- Modify: `apps/api/src/lib/ai.test.ts`
- Modify: `apps/api/src/soul/extract.ts`
- Modify: `apps/api/src/soul/extract.test.ts`

- [ ] **Step 1: Write the failing test additions in `lib/ai.test.ts`**

Append (don't replace existing tests):

```ts
// eslint-disable-next-line import/order -- additional imports for runAgent tests
import { runAgent } from "./ai";

const generateTextMock = vi.mocked(
  (await import("ai")).generateText as unknown as ReturnType<typeof vi.fn>,
);

describe("runAgent", () => {
  it("calls generateText with two tools + stopWhen + system prompt + user content parts", async () => {
    generateTextMock.mockResolvedValue({
      text: "Recebi sua logo! Cores principais: #112233.",
      toolCalls: [],
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
    } as never);

    const prisma = { brandAsset: { update: vi.fn() } } as never;

    const result = await runAgent({
      currentContext: "# Business Context\n\nwhatYouDo: salão",
      input: {
        audioBytes: undefined,
        audioMime: undefined,
        imageBytes: [
          { assetId: "asset_1", bytes: new Uint8Array([7, 7]), mimeType: "image/jpeg" },
        ],
        text: "Aqui está minha logo",
      },
      newAssets: [{ assetId: "asset_1", deduped: false, mimeType: "image/jpeg" }],
      existingAssets: [],
      orgId: "org_1",
      oversizeCount: 0,
      prisma,
    });

    expect(generateTextMock).toHaveBeenCalledOnce();
    const args = generateTextMock.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ data?: Uint8Array; mediaType?: string; text?: string; type: string }>; role: string }>;
      system: string;
      tools: Record<string, unknown>;
    };
    expect(Object.keys(args.tools).sort()).toEqual(["extractSoul", "labelBrandAsset"]);
    expect(args.system).toContain("Você é um assistente onboarding");
    expect(args.system).toContain("asset_1");
    expect(args.system).toContain("whatYouDo: salão");
    const userContent = args.messages[0]!.content;
    expect(userContent.some((p) => p.type === "text" && p.text === "Aqui está minha logo")).toBe(true);
    expect(userContent.some((p) => p.type === "file" && p.mediaType === "image/jpeg")).toBe(true);
    expect(result.text).toBe("Recebi sua logo! Cores principais: #112233.");
    expect(result.usage.inputTokens).toBe(50);
  });

  it("counts toolCalls in toolCallSummary", async () => {
    generateTextMock.mockResolvedValue({
      text: "Done.",
      toolCalls: [
        { toolName: "extractSoul" },
        { toolName: "labelBrandAsset" },
        { toolName: "labelBrandAsset" },
      ],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);

    const prisma = { brandAsset: { update: vi.fn() } } as never;

    const result = await runAgent({
      currentContext: "",
      input: { audioBytes: undefined, audioMime: undefined, imageBytes: [], text: "oi" },
      newAssets: [],
      existingAssets: [],
      orgId: "org_1",
      oversizeCount: 0,
      prisma,
    });

    expect(result.toolCallSummary).toEqual({ extractSoul: 1, labelBrandAsset: 2 });
  });
});
```

Also update the `vi.mock("ai", …)` factory near the top of `ai.test.ts` to expose `generateText` + `stepCountIs`:

```ts
vi.mock("ai", () => ({
  gateway: vi.fn(() => ({})),
  generateObject: vi.fn(),
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ steps: n })),
}));
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter api exec vitest run src/lib/ai.test.ts
```
Expected: FAIL with `runAgent is not exported`.

- [ ] **Step 3: Add `runAgent` to `apps/api/src/lib/ai.ts`** (alongside the existing `extractSoul`)

Add these imports if not present (preserve alphabetical sort):

```ts
import { gateway, generateObject, generateText, stepCountIs } from "ai";
```

(Note: `generateObject` stays — Phase 2.5's `extractSoul` still uses it until Task 3.5.)

Add at the bottom of `lib/ai.ts`, before `export`:

```ts
import type { PrismaClient } from "@repo/db";

import { applySoulUpdate } from "../soul/apply";

type AgentInput = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
  text?: string;
};

type AssetSummary = { assetId: string; deduped: boolean; mimeType: string };

type ExistingAssetSummary = { assetId: string; metadata: unknown; mimeType: string };

type AgentResult = {
  text: string;
  toolCallSummary: { extractSoul: number; labelBrandAsset: number };
  usage: { inputTokens: number; outputTokens: number };
};

const extractSoulToolInput = z.object({
  brandVoice: z.string().nullable(),
  differentiator: z.string().nullable(),
  location: z.string().nullable(),
  targetAudience: z.string().nullable(),
  whatYouDo: z.string().nullable(),
});

const labelBrandAssetToolInput = z.object({
  assetId: z.string().min(1),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/i)).min(1).max(8),
  styleDescriptors: z.array(z.string().min(1)).min(1).max(6),
  typography: z.enum(["serif", "sans", "script", "handwritten", "decorative", "unknown"]),
});

const AGENT_SYSTEM_TEMPLATE = `Você é um assistente onboarding de negócio. O dono fala com você por texto, áudio ou imagem em português brasileiro.

Você tem 2 ferramentas:
1) extractSoul — chame quando a mensagem trouxer informação sobre o negócio (5 campos: whatYouDo, targetAudience, differentiator, brandVoice, location).
2) labelBrandAsset — chame UMA VEZ por assetId listado em "Novos assets nesta mensagem". Olhe a imagem correspondente e extraia palette (até 8 hex), styleDescriptors (até 6, em pt-BR), e typography.

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
- Se for fora do tema, redirecione com gentileza.
- Nunca invente fatos.`;

const renderAssetsBlock = (assets: ReadonlyArray<AssetSummary>): string => {
  if (assets.length === 0) return "(nenhum)";
  return assets
    .map((a) => `- assetId: ${a.assetId}, mimeType: ${a.mimeType}${a.deduped ? " (já estava no perfil — NÃO labelar)" : ""}`)
    .join("\n");
};

const renderExistingBlock = (assets: ReadonlyArray<ExistingAssetSummary>): string => {
  if (assets.length === 0) return "(nenhum)";
  return assets
    .map((a) => `- assetId: ${a.assetId}, mimeType: ${a.mimeType}, metadata: ${JSON.stringify(a.metadata)}`)
    .join("\n");
};

const renderAgentSystem = (args: {
  currentContext: string;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  newAssets: ReadonlyArray<AssetSummary>;
  oversizeCount: number;
}): string =>
  AGENT_SYSTEM_TEMPLATE.replace(
    "{{currentContext}}",
    args.currentContext.length > 0 ? args.currentContext : "(perfil vazio)",
  )
    .replace("{{existingAssetsBlock}}", renderExistingBlock(args.existingAssets))
    .replace("{{newAssetsBlock}}", renderAssetsBlock(args.newAssets))
    .replace("{{oversizeCount}}", String(args.oversizeCount));

const buildAgentUserContent = (input: AgentInput) => {
  const parts: Array<
    | { data: Uint8Array; mediaType: string; type: "file" }
    | { text: string; type: "text" }
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

const runAgent = async (args: {
  currentContext: string;
  existingAssets: ReadonlyArray<ExistingAssetSummary>;
  input: AgentInput;
  newAssets: ReadonlyArray<AssetSummary>;
  orgId: string;
  oversizeCount: number;
  prisma: PrismaClient;
}): Promise<AgentResult> => {
  const { orgId, prisma } = args;

  const tools = {
    extractSoul: {
      description:
        "Atualize os 5 campos do perfil do dono. Use SOMENTE quando a mensagem trouxer info ou correção. Campos não mencionados ficam null.",
      execute: async (partial: z.infer<typeof extractSoulToolInput>) => {
        const out = await applySoulUpdate(orgId, partial, prisma);
        return { capturedFields: out.capturedFields };
      },
      inputSchema: extractSoulToolInput,
    },
    labelBrandAsset: {
      description:
        "Anote metadados visuais de UM asset que o dono enviou. Use um assetId de 'Novos assets'. Chame uma vez por assetId.",
      execute: async (toolArgs: z.infer<typeof labelBrandAssetToolInput>) => {
        await prisma.brandAsset.update({
          data: {
            metadata: {
              palette: toolArgs.palette,
              styleDescriptors: toolArgs.styleDescriptors,
              typography: toolArgs.typography,
            },
          },
          where: { id: toolArgs.assetId },
        });
        return { ok: true };
      },
      inputSchema: labelBrandAssetToolInput,
    },
  };

  const result = await generateText({
    messages: [{ content: buildAgentUserContent(args.input), role: "user" }],
    model: gateway("google/gemini-2.5-flash"),
    stopWhen: stepCountIs(5),
    system: renderAgentSystem({
      currentContext: args.currentContext,
      existingAssets: args.existingAssets,
      newAssets: args.newAssets,
      oversizeCount: args.oversizeCount,
    }),
    temperature: 0.2,
    tools,
  });

  const summary = { extractSoul: 0, labelBrandAsset: 0 };
  for (const call of result.toolCalls ?? []) {
    const name = (call as { toolName: string }).toolName;
    if (name === "extractSoul") summary.extractSoul += 1;
    else if (name === "labelBrandAsset") summary.labelBrandAsset += 1;
  }

  return {
    text: result.text,
    toolCallSummary: summary,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
};

export { runAgent };
export type { AgentInput, AgentResult, AssetSummary, ExistingAssetSummary };
```

If oxlint demands a different import order, reorder; preserve behavior. Note `applySoulUpdate` import path — adjust if the file structure causes a circular-import warning.

- [ ] **Step 4: Add `runAgent` re-export in `soul/extract.ts`**

Keep existing `extractFromMessage` for now (deleted in Task 3.5). Append:

```ts
import { runAgent as runAgentImpl } from "../lib/ai";

const runAgent = runAgentImpl;

export { runAgent };
export type { AgentInput, AgentResult, AssetSummary, ExistingAssetSummary } from "../lib/ai";
```

- [ ] **Step 5: Run tests to confirm GREEN**

```bash
pnpm --filter api exec vitest run src/lib/ai.test.ts
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

Expected: all green. Test count up by 2 (48 → 50). Lint 0/0.

If a TypeScript error fires about `result.toolCalls` not being typed, cast minimally (`result.toolCalls ?? []` already handles undefined).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/ai.ts apps/api/src/lib/ai.test.ts apps/api/src/soul/extract.ts apps/api/src/soul/extract.test.ts
git commit -m "feat(api): lib/ai adds runAgent (generateText + tools: extractSoul, labelBrandAsset)"
```

---

## Task 3.5: handler swaps to `runAgent` + image pre-processing + cleanup (TDD)

The big handler refactor. Pre-process image attachments via `ingestBrandAsset`, query existing brand assets, call `runAgent`, post `result.text`. Drop the now-dead `extractSoul`/`extractFromMessage` functions (Phase 2.5 leftovers).

**Files:**
- Modify: `apps/api/src/telegram/handler.ts`
- Modify: `apps/api/src/telegram/handler.test.ts`
- Modify: `apps/api/src/lib/ai.ts` (delete dead `extractSoul`)
- Modify: `apps/api/src/lib/ai.test.ts` (delete dead tests for `extractSoul`)
- Modify: `apps/api/src/soul/extract.ts` (delete `extractFromMessage`)
- Modify: `apps/api/src/soul/extract.test.ts` (delete dead tests)

- [ ] **Step 1: Rewrite `apps/api/src/telegram/handler.test.ts`** (RED)

Replace with the new test suite:

```ts
import { describe, expect, it, vi } from "vitest";

import { handleIncomingMessage, type HandlerDeps } from "./handler";

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
    brandAsset: {
      findMany: vi.fn().mockResolvedValue([]),
    },
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
  getBusinessContext: ReturnType<typeof vi.fn>;
  ingestBrandAsset: ReturnType<typeof vi.fn>;
  prisma: ReturnType<typeof makePrisma>;
  runAgent: ReturnType<typeof vi.fn>;
}> = {}): HandlerDeps => {
  const prisma = over.prisma ?? makePrisma();
  return {
    getBusinessContext: (over.getBusinessContext ?? vi.fn().mockResolvedValue("")) as unknown as HandlerDeps["getBusinessContext"],
    ingestBrandAsset:
      (over.ingestBrandAsset ??
      vi.fn().mockImplementation(async (a: { mimeType: string }) => ({
        assetId: `asset_${a.mimeType}`,
        deduped: false,
      }))) as unknown as HandlerDeps["ingestBrandAsset"],
    prisma: prisma as unknown as HandlerDeps["prisma"],
    runAgent:
      (over.runAgent ??
      vi.fn().mockResolvedValue({
        text: "Anotei!",
        toolCallSummary: { extractSoul: 1, labelBrandAsset: 0 },
        usage: { inputTokens: 1, outputTokens: 1 },
      })) as unknown as HandlerDeps["runAgent"],
  };
};

describe("handleIncomingMessage", () => {
  it("creates org+conversation+message and posts the agent's text on text input", async () => {
    const deps = makeDeps();
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "sou um salão" }));

    expect(deps.runAgent).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledWith("Anotei!");
  });

  it("is idempotent — duplicate message id is a no-op", async () => {
    const prisma = makePrisma();
    (prisma as never as { webhookEvent: { findUnique: ReturnType<typeof vi.fn> } }).webhookEvent.findUnique.mockResolvedValue({ id: "wh_1" });
    const deps = makeDeps({ prisma });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage());

    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });

  it("downloads audio attachments and forwards bytes to runAgent", async () => {
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
    const call = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { input: { audioBytes?: Uint8Array; audioMime?: string } };
    expect(call.input.audioBytes).toBe(bytes);
    expect(call.input.audioMime).toBe("audio/ogg");
  });

  it("ingests image attachments and passes new assets + image bytes to runAgent", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const fetchData = vi.fn().mockResolvedValue(imageBytes);
    const ingestBrandAsset = vi.fn().mockResolvedValue({ assetId: "asset_logo", deduped: false });
    const deps = makeDeps({ ingestBrandAsset });
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "image/png", name: "logo.png" }],
        text: "minha logo",
      }),
    );

    expect(fetchData).toHaveBeenCalledOnce();
    expect(ingestBrandAsset).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: imageBytes, mimeType: "image/png", orgId: "org_1" }),
    );
    const call = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      input: { imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }> };
      newAssets: Array<{ assetId: string; deduped: boolean; mimeType: string }>;
    };
    expect(call.newAssets).toEqual([{ assetId: "asset_logo", deduped: false, mimeType: "image/png" }]);
    expect(call.input.imageBytes).toEqual([
      { assetId: "asset_logo", bytes: imageBytes, mimeType: "image/png" },
    ]);
  });

  it("on dedup hit does NOT include bytes in input.imageBytes but does flag in newAssets", async () => {
    const bytes = new Uint8Array([5]);
    const fetchData = vi.fn().mockResolvedValue(bytes);
    const ingestBrandAsset = vi.fn().mockResolvedValue({ assetId: "asset_existing", deduped: true });
    const deps = makeDeps({ ingestBrandAsset });
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "image/jpeg" }],
        text: "",
      }),
    );

    const call = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      input: { imageBytes: Array<unknown> };
      newAssets: Array<{ deduped: boolean }>;
    };
    expect(call.newAssets[0]!.deduped).toBe(true);
    expect(call.input.imageBytes).toEqual([]);
  });

  it("skips images larger than 20MB and reports oversizeCount", async () => {
    const bigBytes = new Uint8Array(21_000_000);
    const fetchData = vi.fn().mockResolvedValue(bigBytes);
    const ingestBrandAsset = vi.fn();
    const deps = makeDeps({ ingestBrandAsset });
    const thread = makeThread();

    await handleIncomingMessage(
      deps,
      thread,
      makeMessage({
        attachments: [{ fetchData, mimeType: "image/jpeg" }],
        text: "logo gigante",
      }),
    );

    expect(ingestBrandAsset).not.toHaveBeenCalled();
    const call = (deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { oversizeCount: number };
    expect(call.oversizeCount).toBe(1);
  });

  it("replies with the empty-text static when message is whitespace + no attachments", async () => {
    const deps = makeDeps({ ingestBrandAsset: vi.fn(), runAgent: vi.fn() });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "   " }));

    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith(
      "Recebi sua mensagem, mas não entendi. Pode tentar de novo?",
    );
  });

  it("apologises when audio download fails", async () => {
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

    expect(deps.runAgent).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledWith("Não consegui baixar seu áudio, pode reenviar?");
  });

  it("apologises when runAgent throws (top-level catch)", async () => {
    const deps = makeDeps({
      runAgent: vi.fn().mockRejectedValue(new Error("agent failed")),
    });
    const thread = makeThread();

    await handleIncomingMessage(deps, thread, makeMessage({ text: "olá" }));

    expect(thread.post).toHaveBeenCalledWith(
      "Tive um problema processando sua mensagem, pode tentar de novo?",
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter api exec vitest run src/telegram/handler.test.ts
```
Expected: FAIL — `HandlerDeps` doesn't have the new keys; mock shape mismatches.

- [ ] **Step 3: Replace `apps/api/src/telegram/handler.ts`** entirely

```ts
import type { PrismaClient } from "@repo/db";

import { logger } from "../lib/logger";
import { runAgent as runAgentDefault } from "../lib/ai";
import { ingestBrandAsset as ingestBrandAssetDefault } from "../soul/brand-asset";
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
  getBusinessContext?: typeof getBusinessContextDefault;
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
  prisma: Pick<
    PrismaClient,
    "$transaction" | "brandAsset" | "conversation" | "message" | "organization" | "telegramLink" | "webhookEvent"
  >;
  runAgent?: typeof runAgentDefault;
};

const EMPTY_TEXT_REPLY = "Recebi sua mensagem, mas não entendi. Pode tentar de novo?";
const DOWNLOAD_FAILED_REPLY = "Não consegui baixar seu áudio, pode reenviar?";
const EXTRACT_FAILED_REPLY = "Tive um problema processando sua mensagem, pode tentar de novo?";
const MAX_IMAGE_BYTES = 20_000_000;

const slugify = (chatId: string): string => `org-tg-${chatId}`.toLowerCase();

const findAudioAttachment = (attachments: ReadonlyArray<IncomingAttachment>) =>
  attachments.find((a) => (a.mimeType ?? "").startsWith("audio"));

const findImageAttachments = (attachments: ReadonlyArray<IncomingAttachment>) =>
  attachments.filter((a) => (a.mimeType ?? "").startsWith("image"));

const toJsonSafe = (value: unknown): unknown => {
  if (value === null) return null;
  if (value === undefined || typeof value === "function") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((v) => toJsonSafe(v)).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = toJsonSafe(v);
      if (cleaned !== undefined) out[k] = cleaned;
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
    getBusinessContext = getBusinessContextDefault,
    ingestBrandAsset = ingestBrandAssetDefault,
    prisma,
    runAgent = runAgentDefault,
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
    const images = findImageAttachments(message.attachments ?? []);

    await prisma.message.create({
      data: {
        content: message.text ?? "",
        contentType: hasAudio ? "AUDIO" : images.length > 0 ? "IMAGE" : "TEXT",
        conversationId: conversation.id,
        externalId: message.id,
        metadata: toJsonSafe({ attachments: message.attachments ?? [] }) as object,
        sender: "CUSTOMER",
      },
    });

    // Pre-process image attachments: download, size-check, ingest (sha256 + R2 + row).
    const newAssets: Array<{ assetId: string; deduped: boolean; mimeType: string }> = [];
    const imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }> = [];
    let oversizeCount = 0;
    for (const img of images) {
      if (!img.fetchData) {
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await img.fetchData();
      } catch (error) {
        logger.error(
          { chatId: thread.id, error, messageId: message.id },
          "image.download_failed",
        );
        continue;
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        oversizeCount += 1;
        continue;
      }
      const mimeType = img.mimeType ?? "application/octet-stream";
      try {
        const { assetId, deduped } = await ingestBrandAsset({
          bytes,
          mimeType,
          orgId: link.orgId,
          prisma,
        });
        newAssets.push({ assetId, deduped, mimeType });
        if (!deduped) {
          imageBytes.push({ assetId, bytes, mimeType });
        }
      } catch (error) {
        logger.error(
          { chatId: thread.id, error, messageId: message.id },
          "image.ingest_failed",
        );
      }
    }

    const text = (message.text ?? "").trim();
    if (!hasAudio && text.length === 0 && newAssets.length === 0 && oversizeCount === 0) {
      await thread.post(EMPTY_TEXT_REPLY);
      return;
    }

    let audioBytes: Uint8Array | undefined;
    if (hasAudio) {
      try {
        if (!audio.fetchData) {
          throw new Error("attachment has no fetchData");
        }
        audioBytes = await audio.fetchData();
      } catch (error) {
        logger.error(
          { chatId: thread.id, error, messageId: message.id },
          "audio.download_failed",
        );
        await thread.post(DOWNLOAD_FAILED_REPLY);
        return;
      }
    }

    const currentContext = await getBusinessContext(link.orgId);

    const existingRows = await prisma.brandAsset.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, metadata: true, mimeType: true },
      take: 20,
      where: { orgId: link.orgId },
    });
    const existingAssets = existingRows.map((r) => ({
      assetId: r.id,
      metadata: r.metadata,
      mimeType: r.mimeType,
    }));

    const result = await runAgent({
      currentContext,
      existingAssets,
      input: { audioBytes, audioMime: audio?.mimeType, imageBytes, text: text.length > 0 ? text : undefined },
      newAssets,
      orgId: link.orgId,
      oversizeCount,
      prisma: prisma as PrismaClient,
    });

    await thread.post(result.text);

    logger.info(
      {
        chatId: thread.id,
        messageId: message.id,
        newAssetIds: newAssets.map((a) => a.assetId),
        oversizeCount,
        replyLength: result.text.length,
        toolCallSummary: result.toolCallSummary,
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

- [ ] **Step 4: Run handler tests — GREEN**

```bash
pnpm --filter api exec vitest run src/telegram/handler.test.ts
```
Expected: PASS (9 tests).

- [ ] **Step 5: Delete dead `extractSoul` from `apps/api/src/lib/ai.ts`**

Remove the Phase 2.5 `extractSoul` function, `interactionSchema`, `SYSTEM_PROMPT_TEMPLATE` (the old non-conversational one), `renderSystemPrompt`, `toUserContent`. Keep `partialSoulSchema` (used by extractSoulTool input). Keep `gateway`/`generateObject` import? Drop `generateObject` from the `ai` import — only `generateText`/`gateway`/`stepCountIs` remain. Update exports: drop `extractSoul`; keep `partialSoulSchema`, `runAgent`. Drop unused types `AudioInput`/`TextInput`/`Input`/`PartialSoul`/`Usage` — replace with the new `AgentInput`/`AgentResult`/etc. exports already added in Task 3.4.

- [ ] **Step 6: Delete dead `extractSoul` tests from `apps/api/src/lib/ai.test.ts`**

Remove the two `describe("extractSoul", …)` blocks. Keep the `runAgent` tests added in Task 3.4. Drop unused imports (`extractSoul`, `Input`).

- [ ] **Step 7: Delete dead `extractFromMessage` from `apps/api/src/soul/extract.ts`**

Replace the file with:
```ts
export { runAgent } from "../lib/ai";
export type { AgentInput, AgentResult, AssetSummary, ExistingAssetSummary } from "../lib/ai";
```

- [ ] **Step 8: Delete dead tests from `apps/api/src/soul/extract.test.ts`**

Replace the file with a single re-export check (since the file is now just a re-export, a smoke test is enough):

```ts
import { describe, expect, it } from "vitest";

import { runAgent } from "./extract";

describe("soul/extract re-exports", () => {
  it("re-exports runAgent from lib/ai", () => {
    expect(typeof runAgent).toBe("function");
  });
});
```

- [ ] **Step 9: Full gates**

```bash
pnpm --filter api typecheck && pnpm --filter api lint && pnpm test
```

All green. Expected test count: started at 48 (after Task 3.4 added 2 runAgent tests = 50), removed 2 `extractSoul` tests + 2 `extract.test.ts` tests + the old 8 `handler.test.ts` tests, added 9 new handler tests + 1 extract re-export = net change: 50 - 2 - 2 - 8 + 9 + 1 = **48**. Verify the actual count.

Lint must be 0/0 (drop unused imports, alphabetize). If oxlint flags any leftover dead identifiers in `lib/ai.ts`, remove them.

- [ ] **Step 10: Verify branch state + greps**

```bash
git branch --show-current   # qolmeia-phase-3-r2-brand-assets
grep -rn "extractSoul\|extractFromMessage" apps/api/src
```
The grep should be empty (all references gone — the tool is named `extractSoul` inside the `tools` object in `lib/ai.ts`, that's fine and expected; what we want gone is the standalone function `extractSoul` and `extractFromMessage`).

If the grep returns lines from `lib/ai.ts` matching the tool key `extractSoul:` — that's acceptable; the tool's named that. Just confirm no standalone exported function `extractSoul` survives.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(api): handler swaps to runAgent + image pre-processing; remove Phase 2.5 extractSoul

- Handler pre-processes images: download → 20MB size-check → ingestBrandAsset (sha256 dedup + R2 upload + row).
- New assets (and image bytes for non-deduped) passed to runAgent.
- Existing brand assets loaded into runAgent context for Q&A.
- runAgent's agent-loop posts result.text; tools execute side effects directly.
- Phase 2.5 fused extractSoul (generateObject) deleted along with extractFromMessage shim.
- 'never silent-fail' wrap preserved; deterministic apologies retained for error/edge branches."
```

---

## Task 3.6: Phase 3 final verification + finishing branch

- [ ] **Step 1: Full gate from clean**

```bash
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```
All green. Test count ~48.

- [ ] **Step 2: Cleanliness greps**

```bash
grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
grep -rniI portless . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers
grep -rn "extractFromMessage" apps/api/src
```
All empty.

- [ ] **Step 3: Seam audit — businessProfile + brandAsset writers**

```bash
grep -rn "businessProfile" apps/api/src | grep -v test
grep -rn "prisma.brandAsset.update\|prisma.brandAsset.create" apps/api/src | grep -v test
```

`businessProfile` production-code hits: only `soul/apply.ts` (writer) + `soul/knowledge-provider.ts` (reader).
`brandAsset.update` production-code hits: only `lib/ai.ts` (inside labelBrandAsset tool execute).
`brandAsset.create` production-code hits: only `soul/brand-asset.ts` (inside ingestBrandAsset).
Clean single-writer/reader per resource.

- [ ] **Step 4: Boot smoke**

```bash
docker compose up -d
sleep 2
docker compose ps --format "table {{.Name}}\t{{.Status}}"
pkill -f "node dist/index.mjs" 2>/dev/null; sleep 1
(cd apps/api && node dist/index.mjs > /tmp/qolmeia-phase-3-smoke.log 2>&1 &)
sleep 4
curl -s localhost:4000/healthz
echo ""
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:4000/telegram/webhook -H 'content-type: application/json' -d '{}'
echo ""
grep -i 'poll' /tmp/qolmeia-phase-3-smoke.log || echo "(no poll lines)"
pkill -f "node dist/index.mjs" 2>/dev/null; sleep 1
```

Expected: docker healthy; `/healthz` healthy JSON; webhook 401; no poll lines.

- [ ] **Step 5: Commit spec + plan docs**

```bash
git add docs/superpowers/specs/2026-05-20-qolmeia-phase-3-r2-brand-assets-design.md docs/superpowers/plans/2026-05-20-qolmeia-phase-3-r2-brand-assets.md
git commit -m "docs(phase-3): R2 brand assets + tool calling spec + plan"
```

- [ ] **Step 6: Dispatch final whole-impl reviewer subagent**

Use opus to review Phase 3 end-to-end: spec coverage, seam audit, tool calling correctness, dedup logic, oversize handling, type consistency, no leakage, secrets hygiene. Returns READY TO MERGE or CHANGES NEEDED.

- [ ] **Step 7: Invoke `superpowers:finishing-a-development-branch`**

Present integration options. Default to Option 1 (merge locally) per the established pattern in this session, but follow the user's choice.

---

## Self-review (completed during planning)

- **Spec coverage:** §1 decisions → Task 3.1 (deps/env/schema); §2 module layout → Tasks 3.2 (storage), 3.3 (brand-asset), 3.4 (lib/ai runAgent), 3.5 (handler refactor); §3 Prisma → Task 3.1; §4 tool schemas → Task 3.4; §5 system prompt → Task 3.4; §6 data flow → Task 3.5; §7 runAgent shape → Task 3.4; §8 error handling → Task 3.5; §9 testing → covered across tasks; §10 out of scope → respected; §11 future → documentation only; §12 seams → Task 3.6 step 3 audits.
- **Placeholder scan:** none. Every step has executable code/commands.
- **Type consistency:** `AgentInput`/`AgentResult`/`AssetSummary`/`ExistingAssetSummary` defined in `lib/ai.ts` (Task 3.4 Step 3), consumed by handler (Task 3.5 Step 3). `HandlerDeps` extends to `{ getBusinessContext?, ingestBrandAsset?, prisma, runAgent? }` — bot.ts at `apps/api/src/telegram/bot.ts` will still compile because all DI overrides are optional and the new fields use `typeof xDefault`. `ingestBrandAsset` signature matches between `soul/brand-asset.ts` (Task 3.3) and handler's call site (Task 3.5). `BrandAsset` compound unique key `orgId_sha256` referenced in `brand-asset.ts` matches the Prisma schema (Task 3.1) `@@unique([orgId, sha256])`.
