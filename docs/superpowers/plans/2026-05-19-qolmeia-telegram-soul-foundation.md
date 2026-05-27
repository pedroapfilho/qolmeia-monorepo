# Qolmeia Telegram + Soul Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the `acme` template down to a Telegram-only API, rename it to `qolmeia`, then build a Telegram webhook that persists incoming messages to Postgres and replies — with all AI/storage seams stubbed for later phases.

**Architecture:** One Hono service (`apps/api`). Phase 0 deletes frontend/auth/email/e2e and renames the tree in a single commit. Phase 1 adds the Chat SDK Telegram adapter (webhook) + Redis state, an additive Prisma schema (`Organization`, `TelegramLink`, `Customer`, `Conversation`, `Message`, `WebhookEvent`), and a message handler behind a `KnowledgeProvider` seam. No AI in Phase 1.

**Tech Stack:** Node 24, pnpm 10, Turborepo, Hono, `@hono/zod-openapi`, Prisma 7 (`@prisma/adapter-pg`), Zod, Vitest, `chat` + `@chat-adapter/telegram` + `@chat-adapter/state-redis`, Docker Compose (local Postgres + Redis).

**Spec:** `docs/superpowers/specs/2026-05-19-qolmeia-telegram-soul-foundation-design.md`

---

## Phase 0 — Prune + Rename (single commit)

> Phase 0 is a destructive refactor, not TDD. The "test" is: the slimmed tree builds, lints, typechecks, the API boots, and `grep -rniI acme` is empty. One commit at the end.

### Task 0.1: Delete unneeded apps, packages, and files

**Files:**

- Delete dirs: `apps/web/`, `apps/landing/`, `packages/ui/`, `packages/tailwind-config/`, `packages/auth/`, `packages/transactional/`, `tests/`
- Delete files: `apps/api/src/lib/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/auth.test.ts`, `apps/api/src/routes/v1/users.ts`, `apps/api/src/services/user.service.ts`, `apps/api/src/services/user.service.test.ts`, `playwright.config.ts`, `verify-auth.js`

- [ ] **Step 1: Delete the directories and files**

```bash
cd /Users/pedroapfilho/dev/qolmeia-monorepo
rm -rf apps/web apps/landing packages/ui packages/tailwind-config packages/auth packages/transactional tests
rm -f apps/api/src/lib/auth.ts apps/api/src/middleware/auth.ts apps/api/src/middleware/auth.test.ts
rm -f apps/api/src/routes/v1/users.ts apps/api/src/services/user.service.ts apps/api/src/services/user.service.test.ts
rm -f playwright.config.ts verify-auth.js
rmdir apps/api/src/routes/v1 apps/api/src/routes apps/api/src/services 2>/dev/null || true
```

- [ ] **Step 2: Verify the surviving tree**

Run: `ls apps packages && ls apps/api/src && ls apps/api/src/middleware`
Expected: `apps/` = `api`; `packages/` = `config-vitest db typescript-config`; `apps/api/src/` has `index.ts lib middleware types` (no `routes/`, no `services/`); `middleware/` = `error-handler.ts error-handler.test.ts security.ts security.test.ts` (no `auth*`).

### Task 0.2: Fix `apps/api` to drop auth/users

**Files:**

- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/lib/env.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Replace `apps/api/src/lib/env.ts`** with the slimmed + Phase 1 schema

```typescript
import { z } from "zod";

export const envSchema = z.object({
  AI_GATEWAY_API_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("4000"),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_REGION: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  REDIS_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().min(1),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  // Throwing at module load aborts the process with a stack trace; preferable to
  // process.exit which loses context and conflicts with unicorn/no-process-exit.
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(z.treeifyError(parsedEnv.error), null, 2)}`,
  );
}

export const env = parsedEnv.data;
```

- [ ] **Step 2: Replace `apps/api/src/lib/env.test.ts`** so it matches the new schema

```typescript
import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_BOT_USERNAME: "qolmeia_bot",
  TELEGRAM_WEBHOOK_SECRET_TOKEN: "secret",
};

describe("envSchema", () => {
  it("parses a valid minimal env with defaults", () => {
    const result = envSchema.parse(base);
    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe("4000");
    expect(result.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  it("rejects when a required var is missing", () => {
    const { REDIS_URL, ...withoutRedis } = base;
    expect(() => envSchema.parse(withoutRedis)).toThrow();
  });
});
```

- [ ] **Step 3: Replace `apps/api/src/index.ts`** removing auth + users route

```typescript
import "dotenv/config";

import { serve } from "@hono/node-server";
import { createRoute, z } from "@hono/zod-openapi";
import { prisma } from "@repo/db";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { createOpenAPIApp } from "./lib/openapi";
import { errorHandler, notFound } from "./middleware/error-handler";
import {
  apiRateLimit,
  requestId,
  requestSizeLimit,
  securityHeaders,
  standardRateLimit,
} from "./middleware/security";

const app = createOpenAPIApp();

app.use("*", requestId);
app.use("*", compress());
app.use("*", requestSizeLimit());
app.use("*", securityHeaders);
app.use(
  "*",
  cors({
    allowHeaders: ["Content-Type", "X-Request-Id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: env.CORS_ORIGINS.split(","),
  }),
);

// Skip logging for health checks
app.use("*", async (c, next) => {
  if (c.req.path === "/healthz") {
    return next();
  }

  const start = Date.now();
  await next();
  const ms = Date.now() - start;

  logger.info({
    duration: ms,
    method: c.req.method,
    status: c.res.status,
    url: c.req.url,
  });
});

app.use("/api/*", standardRateLimit);
app.use("/api/v1/*", apiRateLimit);

const healthRoute = createRoute({
  description: "Liveness probe — does not touch the database.",
  method: "get",
  path: "/healthz",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            service: z.string(),
            status: z.literal("healthy"),
            timestamp: z.iso.datetime(),
            version: z.string(),
          }),
        },
      },
      description: "API is healthy",
    },
  },
  summary: "Liveness check",
  tags: ["System"],
});

app.openapi(healthRoute, (c) =>
  c.json(
    {
      service: "api",
      status: "healthy" as const,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    },
    200,
  ),
);

const readyzResponseSchema = z.object({
  checks: z.object({ database: z.enum(["healthy", "unhealthy"]) }),
  status: z.enum(["ready", "not ready"]),
  timestamp: z.iso.datetime(),
});

const readyzRoute = createRoute({
  description: "Readiness probe — verifies the database is reachable.",
  method: "get",
  path: "/readyz",
  responses: {
    200: {
      content: { "application/json": { schema: readyzResponseSchema } },
      description: "API is ready to serve traffic",
    },
    503: {
      content: { "application/json": { schema: readyzResponseSchema } },
      description: "API is not ready (e.g. database unreachable)",
    },
  },
  summary: "Readiness check",
  tags: ["System"],
});

app.openapi(readyzRoute, async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return c.json(
      {
        checks: { database: "healthy" as const },
        status: "ready" as const,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  } catch (error) {
    logger.error({ error }, "Readiness check failed");
    return c.json(
      {
        checks: { database: "unhealthy" as const },
        status: "not ready" as const,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
});

const openApiContent = app.getOpenAPI31Document({
  info: { title: "Qolmeia API", version: "v1" },
  openapi: "3.1.0",
});

const llmsMarkdown = await createMarkdownFromOpenApi(JSON.stringify(openApiContent));

app.get("/llms.txt", (c) => c.text(llmsMarkdown));

app.notFound(notFound);

app.onError(errorHandler);

const port = Number(env.PORT) || 4000;
const hostname = env.HOST || "0.0.0.0";

logger.info(
  {
    env: env.NODE_ENV,
    hostname,
    port,
  },
  "🚀 Starting server...",
);

serve({
  fetch: app.fetch,
  hostname,
  port,
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});
```

- [ ] **Step 4: Edit `apps/api/package.json`** — remove the `@repo/auth` dependency line

Remove this line from `dependencies`:

```json
    "@repo/auth": "workspace:*",
```

- [ ] **Step 5: Verify no dangling references**

Run: `grep -rn "@repo/auth\|@repo/transactional\|@repo/ui\|middleware/auth\|routes/v1/users\|services/user" apps/api/src`
Expected: no output.

### Task 0.3: Trim root `package.json`, `turbo.json`, `pnpm` build deps

**Files:**

- Modify: `package.json`
- Modify: `turbo.json`

- [ ] **Step 1: Replace root `package.json`**

```json
{
  "name": "qolmeia",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "turbo run start",
    "dev": "turbo dev",
    "lint": "oxlint .",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "typecheck": "turbo run typecheck",
    "build": "turbo run build",
    "clean": "turbo run clean && rm -rf node_modules",
    "db:generate": "turbo run db:generate",
    "db:push": "turbo run db:push",
    "db:seed": "turbo run db:seed",
    "test": "turbo run test",
    "fallow": "fallow",
    "fallow:dead": "fallow dead-code",
    "fallow:dupes": "fallow dupes",
    "fallow:health": "fallow health --score",
    "fallow:audit": "fallow audit --base main",
    "prepare": "husky"
  },
  "devDependencies": {
    "@repo/db": "workspace:*",
    "fallow": "^2.69.0",
    "husky": "^9.1.7",
    "lint-staged": "^17.0.4",
    "oxfmt": "^0.48.0",
    "oxlint": "^1.63.0",
    "oxlint-config-awesomeness": "^3.0.2",
    "turbo": "^2.9.12"
  },
  "lint-staged": {
    "!(*.d).{ts,tsx,mts,cts,js,jsx,mjs,cjs}": ["oxlint"],
    "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,md}": ["oxfmt"]
  },
  "engines": {
    "node": ">=24"
  },
  "packageManager": "pnpm@10.33.0",
  "pnpm": {
    "onlyBuiltDependencies": [
      "@prisma/client",
      "@prisma/engines",
      "esbuild",
      "fallow",
      "prisma",
      "unrs-resolver"
    ]
  }
}
```

- [ ] **Step 2: Replace `turbo.json`** (drop auth/web env vars; keep DB)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "globalDependencies": ["**/.env.*local"],
  "globalEnv": ["NODE_ENV"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "env": [
        "AI_GATEWAY_API_KEY",
        "CORS_ORIGINS",
        "DATABASE_URL",
        "REDIS_URL",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
        "TELEGRAM_WEBHOOK_SECRET_TOKEN",
        "R2_ACCOUNT_ID",
        "R2_BUCKET",
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_REGION"
      ]
    },
    "lint": { "dependsOn": ["^build"], "outputs": [] },
    "typecheck": { "dependsOn": ["^build"] },
    "format:check": { "cache": false },
    "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true },
    "start": { "dependsOn": ["^build"], "cache": false },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"], "cache": false },
    "clean": { "cache": false },
    "db:generate": { "cache": false, "env": ["DATABASE_URL"] },
    "db:push": { "cache": false, "env": ["DATABASE_URL"] },
    "db:seed": { "cache": false, "env": ["DATABASE_URL"] }
  }
}
```

### Task 0.4: Rewrite `docker-compose.yml` (qolmeia + Redis)

**Files:**

- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace `docker-compose.yml`**

```yaml
name: qolmeia

services:
  postgres:
    image: postgres:18-alpine
    container_name: qolmeia-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: qolmeia
      POSTGRES_PASSWORD: qolmeia123
      POSTGRES_DB: qolmeia
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U qolmeia -d qolmeia"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:7-alpine
    container_name: qolmeia-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
```

### Task 0.5: Rename remaining `acme` → `qolmeia` (case-preserving)

**Files:** all surviving tracked files containing `acme` (after Task 0.1 the set is: `apps/api/package.json`, `apps/api/src/lib/openapi.ts`, `apps/api/.env.example`, `packages/db/.env.example`, `README.md`, `AGENTS.md`; root `package.json`/`docker-compose.yml` already done in 0.3/0.4).

- [ ] **Step 1: Apply the three case-preserving replacements**

```bash
cd /Users/pedroapfilho/dev/qolmeia-monorepo
FILES=$(grep -rlI --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo -e 'acme' -e 'Acme' -e 'ACME' .)
for f in $FILES; do
  perl -pi -e 's/ACME/QOLMEIA/g; s/Acme/Qolmeia/g; s/acme/qolmeia/g' "$f"
done
```

- [ ] **Step 2: Verify zero remaining occurrences**

Run: `grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo`
Expected: only `docs/superpowers/specs/...` and `docs/superpowers/plans/...` may match (they discuss the rename itself). No source/config matches. If a source/config file matches, fix it by hand.

- [ ] **Step 3: Sanity-check the high-value renames**

Run: `grep -n qolmeia apps/api/package.json apps/api/src/lib/openapi.ts docker-compose.yml package.json`
Expected: portless `--name qolmeia.api`; openapi contact `support@qolmeia.com` + server `https://api.qolmeia.com`; docker `qolmeia`/`qolmeia123`; root name `qolmeia`.

### Task 0.6: Reinstall, verify, single commit

- [ ] **Step 1: Reinstall (workspace changed)**

Run: `pnpm install`
Expected: completes; lockfile updates; no missing-workspace errors.

- [ ] **Step 2: Start local infra + push schema is deferred**

(The current Prisma schema still has Better Auth models; Phase 1 replaces it. Do NOT `db:push` yet.)

- [ ] **Step 3: Build, lint, typecheck, test**

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: all succeed. `pnpm test` for `api` runs the env test (green).

- [ ] **Step 4: Commit Phase 0 (single combined commit)**

```bash
git add -A
git commit -m "chore: prune to Telegram-only API and rename acme→qolmeia

Remove apps/web, apps/landing, @repo/{ui,tailwind-config,auth,transactional},
Better Auth (api auth code + models), Playwright e2e. Rename acme→qolmeia.
Add local Redis to docker-compose."
```

---

## Phase 1 — Telegram + Soul Foundation (TDD)

> Phase 1 is TDD. Each task: failing test → run (fail) → implement → run (pass) → commit.

### Task 1.1: Add Chat SDK dependencies

**Files:**

- Modify: `apps/api/package.json`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm --filter api add chat @chat-adapter/telegram @chat-adapter/state-redis
```

Expected: three packages added to `apps/api/package.json` `dependencies`; install succeeds.

- [ ] **Step 2: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add Chat SDK + telegram + redis-state deps"
```

### Task 1.2: Prisma schema — Phase 1 models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Replace `packages/db/prisma/schema.prisma`**

```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

enum Channel {
  WEB_CHAT
  TELEGRAM
}

enum ConversationStatus {
  ACTIVE
  RESOLVED
  ARCHIVED
}

enum MessageSender {
  CUSTOMER
  AGENT
  SYSTEM
}

enum ContentType {
  TEXT
  AUDIO
  IMAGE
  DOCUMENT
}

model Organization {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  timezone        String   @default("America/Sao_Paulo")
  currency        String   @default("BRL")
  // The "soul" — accessed ONLY via KnowledgeProvider.getBusinessContext().
  businessProfile Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  telegramLink  TelegramLink?
  customers     Customer[]
  conversations Conversation[]

  @@index([slug])
}

model TelegramLink {
  id             String       @id @default(cuid())
  telegramChatId String       @unique
  orgId          String       @unique
  org            Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model Customer {
  id        String   @id @default(cuid())
  orgId     String
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  phone     String?
  email     String?
  name      String?
  meta      Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  conversations Conversation[]

  @@unique([orgId, phone])
  @@unique([orgId, email])
  @@index([orgId])
}

model Conversation {
  id         String             @id @default(cuid())
  channel    Channel            @default(TELEGRAM)
  externalId String?
  status     ConversationStatus @default(ACTIVE)
  orgId      String
  org        Organization       @relation(fields: [orgId], references: [id], onDelete: Cascade)
  customerId String?
  customer   Customer?          @relation(fields: [customerId], references: [id])
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt

  messages Message[]

  @@index([orgId, status])
}

model Message {
  id             String        @id @default(cuid())
  conversationId String
  conversation   Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  externalId     String?
  sender         MessageSender
  content        String
  contentType    ContentType   @default(TEXT)
  metadata       Json?
  createdAt      DateTime      @default(now())

  @@unique([conversationId, externalId])
  @@index([conversationId, createdAt])
}

model WebhookEvent {
  id         String   @id @default(cuid())
  provider   String
  externalId String
  payload    Json
  status     String   @default("processed")
  createdAt  DateTime @default(now())

  @@unique([provider, externalId])
}
```

- [ ] **Step 2: Start local infra**

Run: `docker compose up -d`
Expected: `qolmeia-postgres` and `qolmeia-redis` healthy (`docker compose ps`).

- [ ] **Step 3: Generate client + push schema (LOCAL db only)**

Run: `pnpm db:generate && pnpm db:push`
Expected: client generated to `packages/db/src/generated/prisma`; `db push` applies to `postgresql://qolmeia:qolmeia123@localhost:5432/qolmeia` (from `packages/db/.env`). Confirm the URL printed is `localhost`, NOT `tramway.proxy.rlwy.net`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): Phase 1 schema (Organization, TelegramLink, Customer, Conversation, Message, WebhookEvent)"
```

### Task 1.3: KnowledgeProvider seam

**Files:**

- Create: `apps/api/src/soul/knowledge-provider.ts`
- Test: `apps/api/src/soul/knowledge-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

import { getBusinessContext } from "./knowledge-provider";

const makePrisma = (businessProfile: unknown) =>
  ({
    organization: {
      findUnique: vi
        .fn()
        .mockResolvedValue(businessProfile === undefined ? null : { businessProfile }),
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
      makePrisma({ whatYouDo: "Salon", audience: "Locals" }),
    );
    expect(result).toContain("# Business Context");
    expect(result).toContain("whatYouDo");
    expect(result).toContain("Salon");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/soul/knowledge-provider.test.ts`
Expected: FAIL — `Cannot find module './knowledge-provider'`.

- [ ] **Step 3: Implement `apps/api/src/soul/knowledge-provider.ts`**

```typescript
import { type PrismaClient, prisma as defaultPrisma } from "@repo/db";

/**
 * Seam #1: agent/bot code MUST call this instead of reading
 * Organization.businessProfile directly. v1 swaps the implementation to read
 * wiki markdown without touching callers.
 */
const getBusinessContext = async (
  orgId: string,
  client: Pick<PrismaClient, "organization"> = defaultPrisma,
): Promise<string> => {
  const org = await client.organization.findUnique({
    where: { id: orgId },
    select: { businessProfile: true },
  });

  const profile = org?.businessProfile;
  if (profile === null || profile === undefined) {
    return "";
  }

  return `# Business Context\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\`\n`;
};

export { getBusinessContext };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/soul/knowledge-provider.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/soul/knowledge-provider.ts apps/api/src/soul/knowledge-provider.test.ts
git commit -m "feat(api): KnowledgeProvider.getBusinessContext seam"
```

### Task 1.4: Soul types (interface only)

**Files:**

- Create: `apps/api/src/soul/soul.ts`

- [ ] **Step 1: Create `apps/api/src/soul/soul.ts`** (types only — write path lands in Phase 2)

```typescript
/** The 5 soul fields. All optional — filled incrementally (free-form accumulate). */
type SoulProfile = {
  whatYouDo?: string;
  targetAudience?: string;
  whatYouDeliver?: string;
  competitors?: string;
  contextLinks?: Array<string>;
};

const SOUL_FIELDS: ReadonlyArray<keyof SoulProfile> = [
  "whatYouDo",
  "targetAudience",
  "whatYouDeliver",
  "competitors",
  "contextLinks",
];

const missingSoulFields = (profile: SoulProfile): Array<keyof SoulProfile> =>
  SOUL_FIELDS.filter((field) => {
    const value = profile[field];
    return value === undefined || (Array.isArray(value) && value.length === 0);
  });

export { missingSoulFields, SOUL_FIELDS };
export type { SoulProfile };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/soul/soul.ts
git commit -m "feat(api): SoulProfile types + missingSoulFields"
```

### Task 1.5: Telegram message handler

**Files:**

- Create: `apps/api/src/telegram/handler.ts`
- Test: `apps/api/src/telegram/handler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

import { handleIncomingMessage } from "./handler";

const makeThread = () => ({ id: "tg_chat_42", post: vi.fn().mockResolvedValue(undefined) });

const makeMessage = (over: Partial<{ id: string; text: string }> = {}) => ({
  id: over.id ?? "msg_1",
  text: over.text ?? "olá",
  attachments: [] as Array<{ name: string; mimeType: string }>,
});

const makePrisma = () => {
  const org = { id: "org_1" };
  const conversation = { id: "conv_1" };
  return {
    webhookEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "wh_1" }),
    },
    telegramLink: { findUnique: vi.fn().mockResolvedValue(null) },
    organization: { create: vi.fn().mockResolvedValue(org) },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(conversation),
    },
    message: { create: vi.fn().mockResolvedValue({ id: "m_1" }) },
  } as never;
};

describe("handleIncomingMessage", () => {
  it("creates org+conversation+message and replies on first contact", async () => {
    const prisma = makePrisma();
    const thread = makeThread();

    await handleIncomingMessage({ prisma }, thread, makeMessage());

    expect(
      (prisma as never as { organization: { create: ReturnType<typeof vi.fn> } }).organization
        .create,
    ).toHaveBeenCalledOnce();
    expect(
      (prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create,
    ).toHaveBeenCalledOnce();
    expect(thread.post).toHaveBeenCalledOnce();
  });

  it("is idempotent — duplicate message id is a no-op", async () => {
    const prisma = makePrisma();
    (
      prisma as never as { webhookEvent: { findUnique: ReturnType<typeof vi.fn> } }
    ).webhookEvent.findUnique.mockResolvedValue({ id: "wh_1" });
    const thread = makeThread();

    await handleIncomingMessage({ prisma }, thread, makeMessage());

    expect(
      (prisma as never as { message: { create: ReturnType<typeof vi.fn> } }).message.create,
    ).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/telegram/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 3: Implement `apps/api/src/telegram/handler.ts`**

```typescript
import { type PrismaClient, prisma as defaultPrisma } from "@repo/db";

import { logger } from "../lib/logger";

type IncomingThread = {
  id: string;
  post: (text: string) => Promise<unknown>;
};

type IncomingAttachment = { name?: string; mimeType?: string };

type IncomingMessage = {
  id: string;
  text?: string;
  attachments?: Array<IncomingAttachment>;
};

type HandlerDeps = {
  prisma: Pick<
    PrismaClient,
    "webhookEvent" | "telegramLink" | "organization" | "conversation" | "message"
  >;
};

const ACK_REPLY =
  "Recebi sua mensagem 👋 Em breve vou transformar seus áudios no perfil do seu negócio.";

const slugify = (chatId: string): string => `org-tg-${chatId}`.toLowerCase();

const handleIncomingMessage = async (
  deps: HandlerDeps,
  thread: IncomingThread,
  message: IncomingMessage,
): Promise<void> => {
  const { prisma } = deps;

  // Durable audit + idempotency (complements the adapter's in-memory dedup).
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: "telegram", externalId: message.id } },
  });
  if (existing) {
    return;
  }
  await prisma.webhookEvent.create({
    data: { provider: "telegram", externalId: message.id, payload: { ...message } },
  });

  // Resolve identity: one Telegram chat == one Organization being onboarded.
  let link = await prisma.telegramLink.findUnique({
    where: { telegramChatId: thread.id },
    select: { orgId: true },
  });

  if (!link) {
    const org = await prisma.organization.create({
      data: {
        name: `Negócio ${thread.id}`,
        slug: slugify(thread.id),
        telegramLink: { create: { telegramChatId: thread.id } },
        conversations: { create: { channel: "TELEGRAM", externalId: thread.id } },
      },
      select: { id: true },
    });
    link = { orgId: org.id };
  }

  const conversation =
    (await prisma.conversation.findFirst({
      where: { orgId: link.orgId, channel: "TELEGRAM" },
      select: { id: true },
    })) ??
    (await prisma.conversation.create({
      data: { orgId: link.orgId, channel: "TELEGRAM", externalId: thread.id },
      select: { id: true },
    }));

  const hasAudio = (message.attachments ?? []).some((a) => (a.mimeType ?? "").startsWith("audio"));

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      externalId: message.id,
      sender: "CUSTOMER",
      content: message.text ?? "",
      contentType: hasAudio ? "AUDIO" : "TEXT",
      metadata: { attachments: message.attachments ?? [] },
    },
  });

  await thread.post(ACK_REPLY);
  logger.info({ chatId: thread.id, messageId: message.id }, "telegram message handled");
};

export { handleIncomingMessage };
export type { HandlerDeps, IncomingMessage, IncomingThread };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/telegram/handler.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/telegram/handler.ts apps/api/src/telegram/handler.test.ts
git commit -m "feat(api): telegram message handler (org/conversation/message + ack)"
```

### Task 1.6: Chat SDK bot singleton

**Files:**

- Create: `apps/api/src/telegram/bot.ts`

- [ ] **Step 1: Create `apps/api/src/telegram/bot.ts`**

```typescript
import { prisma } from "@repo/db";
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createRedisState } from "@chat-adapter/state-redis";

import { env } from "../lib/env";
import { handleIncomingMessage } from "./handler";

// Adapter auto-detects TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET_TOKEN /
// TELEGRAM_BOT_USERNAME; createRedisState() auto-detects REDIS_URL. We read
// env here so the Zod schema fails fast at boot if any are missing.
void env.TELEGRAM_BOT_TOKEN;
void env.REDIS_URL;

const bot = new Chat({
  userName: env.TELEGRAM_BOT_USERNAME,
  adapters: { telegram: createTelegramAdapter() },
  state: createRedisState(),
  logger: "info",
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await handleIncomingMessage({ prisma }, thread, message);
});

bot.onSubscribedMessage(async (thread, message) => {
  await handleIncomingMessage({ prisma }, thread, message);
});

export { bot };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS. If the SDK's `thread`/`message` types are nominal and conflict with the structural `IncomingThread`/`IncomingMessage`, adjust `handler.ts` to accept `Parameters<Parameters<typeof bot.onSubscribedMessage>[0]>` — but first try as-is; structural typing usually accepts it.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/telegram/bot.ts
git commit -m "feat(api): Chat SDK telegram bot singleton wired to handler"
```

### Task 1.7: Webhook route + mount

**Files:**

- Create: `apps/api/src/routes/telegram/webhook.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/routes/telegram/webhook.ts`**

```typescript
import { Hono } from "hono";

import { bot } from "../../telegram/bot";

const telegramWebhookRoutes = new Hono();

// The adapter validates the X-Telegram-Bot-Api-Secret-Token header internally.
telegramWebhookRoutes.post("/webhook", (c) => bot.webhooks.telegram(c.req.raw));

export { telegramWebhookRoutes };
```

- [ ] **Step 2: Mount it in `apps/api/src/index.ts`**

Add this import with the other local imports (after the `./middleware/security` import):

```typescript
import { telegramWebhookRoutes } from "./routes/telegram/webhook";
```

Add this line immediately after `app.use("/api/v1/*", apiRateLimit);`:

```typescript
app.route("/telegram", telegramWebhookRoutes);
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter api typecheck && pnpm --filter api build`
Expected: PASS; `apps/api/dist/index.mjs` produced.

- [ ] **Step 4: Boot smoke test**

Run (with `docker compose up -d` already running):

```bash
node apps/api/dist/index.mjs &
sleep 3
curl -s localhost:4000/healthz
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:4000/telegram/webhook -H 'content-type: application/json' -d '{}'
kill %1
```

Expected: `/healthz` returns the healthy JSON; the webhook POST returns a non-5xx status (the adapter rejects an unsigned/empty body — a 4xx is correct and proves the route + adapter are wired).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/telegram/webhook.ts apps/api/src/index.ts
git commit -m "feat(api): mount POST /telegram/webhook"
```

### Task 1.8: README local-dev section

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Append a "Telegram (local dev)" section to `README.md`**

````markdown
## Telegram bot (local dev)

The bot (`@qolmeia_mvp_v0_bot`) receives updates via webhook. Telegram needs a
public HTTPS URL, so tunnel the local API:

1. `docker compose up -d` (Postgres + Redis)
2. `pnpm dev --filter=api`
3. `cloudflared tunnel --url http://localhost:4000` (or `ngrok http 4000`)
4. Register the webhook (token + secret are in `apps/api/.env`):

   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://<your-tunnel-host>/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET_TOKEN>"
   ```
````

5. Message the bot on Telegram — it persists the message and replies.

````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Telegram local-dev webhook setup"
````

### Task 1.9: Full verification

- [ ] **Step 1: Run the whole gate**

Run: `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. `api` test suite = env + knowledge-provider + handler tests passing.

- [ ] **Step 2: Confirm no `acme` survived**

Run: `grep -rniI acme . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.turbo | grep -v docs/superpowers`
Expected: no output.

---

## Self-Review (completed during planning)

- **Spec coverage:** Phase 0 prune (§2.1) → Task 0.1; api de-auth (§2.3) → 0.2; root/turbo (§2) → 0.3; docker+redis (§2.4) → 0.4; rename (§2.5) → 0.5; env cleanup (§2.5) → 0.2 step 1. Phase 1: deps → 1.1; schema (§3.4) → 1.2; KnowledgeProvider seam #1 (§3.2) → 1.3; soul types (§3.2) → 1.4; handler+idempotency+flow (§3.5/3.6) → 1.5; bot/adapter (§3.2) → 1.6; webhook route (§3.5 step 1) → 1.7; local-dev doc (§3.7) → 1.8; testing (§3.7) → 1.3/1.5; verification → 1.9. `lib/ai.ts`/`lib/storage.ts`/`lib/redis.ts` are explicitly Phase 2+ per the updated spec — no Phase 1 task, by design.
- **Placeholder scan:** none — every code step has full content.
- **Type consistency:** `getBusinessContext(orgId, client?)`, `handleIncomingMessage(deps, thread, message)`, `HandlerDeps.prisma`, `SoulProfile` used consistently across tasks 1.3–1.7.

```

```
