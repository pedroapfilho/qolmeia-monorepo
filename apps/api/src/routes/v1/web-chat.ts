import type { ConnectorInstance, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";

import { ensureAgentInstance } from "@/agents/agent-instance";
import type { AgentDispatcher } from "@/agents/dispatcher";
import { dispatcher as defaultDispatcher } from "@/agents/main-dispatcher";
import { webChatAdapter } from "@/connectors/web-chat/adapter";
import { handleInbound as defaultHandleInbound } from "@/inbox/pipeline";
import type { PipelineDeps } from "@/inbox/pipeline";
import {
  badRequest,
  buildListResponse,
  notFound,
  parsePagination,
  validationError,
} from "@/lib/api-response";
import { fetchAsset as defaultFetchAsset } from "@/lib/storage";
import { webChatBus as defaultBus } from "@/lib/web-chat-bus";
import type { CustomerContextVars } from "@/middleware/require-customer";

type WebChatPrisma = Pick<
  PrismaClient,
  | "activityLog"
  | "agentConnectorBinding"
  | "agentInstance"
  | "brandAsset"
  | "connectorInstance"
  | "conversation"
  | "message"
  | "organization"
> &
  PipelineDeps["prisma"];

type WebChatRouteDeps = {
  bus?: typeof defaultBus;
  dispatcher?: AgentDispatcher;
  fetchAsset?: typeof defaultFetchAsset;
  handleInbound?: typeof defaultHandleInbound;
  prisma?: WebChatPrisma;
};

const postMessageSchema = z.object({
  attachments: z
    .array(
      z.object({
        kind: z.enum(["audio", "document", "image"]),
        mimeType: z.string().optional(),
        sizeBytes: z.number().int().nonnegative(),
        url: z.string().url().optional(),
      }),
    )
    .optional(),
  conversationId: z.string().min(1).optional(),
  text: z.string().max(20_000).optional(),
});

// Find or create the org's WEB_CHAT ConnectorInstance + the controller
// AgentConnectorBinding so the inbox pipeline has a valid route. Idempotent.
const ensureWebChatConnectorInstance = async ({
  orgId,
  prisma,
}: {
  orgId: string;
  prisma: WebChatPrisma;
}): Promise<ConnectorInstance> => {
  const existing = await prisma.connectorInstance.findFirst({
    where: { orgId, type: "WEB_CHAT" },
  });
  if (existing) {
    return existing;
  }

  const created = await prisma.connectorInstance.create({
    data: {
      capabilities: { inbound: true, outbound: true },
      config: {},
      displayName: "Chat do cliente",
      orgId,
      // CUSTOMER side: incoming web-chat messages come from the business's
      // customer, so the approval rule (§8) treats drafted actions
      // accordingly.
      senderRole: "CUSTOMER",
      type: "WEB_CHAT",
    },
  });

  // Mirror the Telegram seed flow: bind the org's Controller agent as the
  // INBOUND handler. Auto-create the AgentInstance if the org doesn't have
  // one yet (same idempotent helper Telegram uses).
  const controller = await ensureAgentInstance({
    orgId,
    prisma,
    templateSlug: "controller",
  });
  await prisma.agentConnectorBinding.upsert({
    create: {
      agentInstanceId: controller.id,
      connectorInstanceId: created.id,
      direction: "INBOUND",
    },
    update: {},
    where: {
      agentInstanceId_connectorInstanceId_direction: {
        agentInstanceId: controller.id,
        connectorInstanceId: created.id,
        direction: "INBOUND",
      },
    },
  });

  return created;
};

const ensureConversation = async ({
  connectorInstanceId,
  conversationId,
  orgId,
  prisma,
}: {
  connectorInstanceId: string;
  conversationId: string | undefined;
  orgId: string;
  prisma: WebChatPrisma;
}): Promise<{ id: string }> => {
  if (conversationId) {
    const found = await prisma.conversation.findFirst({
      select: { id: true },
      where: { connectorInstanceId, id: conversationId, orgId },
    });
    if (!found) {
      throw new Error("CONVERSATION_NOT_FOUND");
    }
    return found;
  }

  const created = await prisma.conversation.create({
    data: {
      channel: "WEB_CHAT",
      connectorInstanceId,
      // For WEB_CHAT, externalId == conversation.id. The pipeline uses
      // externalThreadId to look up Conversation; we re-link via the
      // connectorInstanceId so a deterministic key isn't required.
      externalId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orgId,
    },
    select: { id: true },
  });
  return created;
};

const buildWebChatRoutes = (
  deps: WebChatRouteDeps = {},
): Hono<{ Variables: CustomerContextVars }> => {
  const prisma = deps.prisma ?? (defaultPrisma as WebChatPrisma);
  const bus = deps.bus ?? defaultBus;
  const dispatcher = deps.dispatcher ?? defaultDispatcher;
  const fetchAsset = deps.fetchAsset ?? defaultFetchAsset;
  const handleInbound = deps.handleInbound ?? defaultHandleInbound;
  const app = new Hono<{ Variables: CustomerContextVars }>();

  // GET /web-chat/conversations — list this customer's conversations.
  app.get("/conversations", async (c) => {
    const orgId = c.get("orgId");
    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 20,
      limit: c.req.query("limit"),
      maxLimit: 100,
    });

    const connector = await prisma.connectorInstance.findFirst({
      where: { orgId, type: "WEB_CHAT" },
    });
    if (!connector) {
      return c.json({ items: [], nextCursor: null });
    }

    const rows = await prisma.conversation.findMany({
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          select: { content: true, createdAt: true, sender: true },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      where: {
        connectorInstanceId: connector.id,
        orgId,
        ...(cursorDate ? { updatedAt: { lt: cursorDate } } : {}),
      },
    });

    const response = buildListResponse(rows, limit, (row) => row.updatedAt);
    return c.json({
      items: response.items.map((conv) => {
        const last = conv.messages[0];
        return {
          createdAt: conv.createdAt.toISOString(),
          id: conv.id,
          lastMessageAt: last ? last.createdAt.toISOString() : null,
          lastMessagePreview: last ? last.content.slice(0, 280) : null,
          status: conv.status,
          updatedAt: conv.updatedAt.toISOString(),
        };
      }),
      nextCursor: response.nextCursor,
    });
  });

  // GET /web-chat/messages?conversationId= — paginated history (oldest→newest
  // is more useful for the UI, but cursor-based descend matches the rest of
  // the API and lets the client reverse for display).
  app.get("/messages", async (c) => {
    const orgId = c.get("orgId");
    const conversationId = c.req.query("conversationId");
    if (!conversationId) {
      return badRequest(c, "conversationId is required");
    }

    const conv = await prisma.conversation.findFirst({
      select: { id: true },
      where: { id: conversationId, orgId },
    });
    if (!conv) {
      return notFound(c, "Conversation not found");
    }

    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 50,
      limit: c.req.query("limit"),
      maxLimit: 200,
    });

    const rows = await prisma.message.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      where: {
        conversationId,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
    });

    const response = buildListResponse(rows, limit);
    return c.json({
      items: response.items.map((row) => ({
        content: row.content,
        contentType: row.contentType,
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        metadata: row.metadata,
        sender: row.sender,
      })),
      nextCursor: response.nextCursor,
    });
  });

  // POST /web-chat/messages — customer sends a message. Resolves (or
  // creates) the WEB_CHAT ConnectorInstance + Conversation, constructs a
  // NormalizedMessage, and dispatches through the unified pipeline.
  app.post("/messages", async (c) => {
    const orgId = c.get("orgId");

    let body: z.infer<typeof postMessageSchema>;
    try {
      body = postMessageSchema.parse(await c.req.json());
    } catch (error) {
      if (error instanceof ZodError) {
        return validationError(c, error);
      }
      return badRequest(c, "Invalid JSON body");
    }

    if (!body.text && (!body.attachments || body.attachments.length === 0)) {
      return badRequest(c, "Message requires text or attachments");
    }

    const connector = await ensureWebChatConnectorInstance({ orgId, prisma });

    let conversation: { id: string };
    try {
      conversation = await ensureConversation({
        connectorInstanceId: connector.id,
        conversationId: body.conversationId,
        orgId,
        prisma,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CONVERSATION_NOT_FOUND") {
        return notFound(c, "Conversation not found");
      }
      throw error;
    }

    // Build the raw inbound payload that web-chat adapter's parseInbound
    // accepts. The pipeline calls parseInbound itself, which mints the
    // externalId uuid via crypto.randomUUID inside the adapter.
    const rawInbound = {
      attachments: body.attachments ?? [],
      authorDisplayName: c.get("session").user.name ?? null,
      conversationId: conversation.id,
      text: body.text ?? null,
    };

    const normalized = await webChatAdapter.parseInboundPayload(rawInbound, connector.config);

    await handleInbound(
      { dispatcher, fetchAsset, prisma },
      { connectorInstance: connector, normalizedMessage: normalized },
    );

    return c.json({
      conversationId: conversation.id,
      messageExternalId: normalized.externalId,
    });
  });

  // GET /web-chat/stream?conversationId= — SSE channel for live updates.
  // Emits `event: message|agent-thinking|asset` for every published event
  // on the conversation's bus channel. 25s keepalive prevents proxies from
  // closing idle streams.
  app.get("/stream", (c) => {
    const orgId = c.get("orgId");
    const conversationId = c.req.query("conversationId");
    if (!conversationId) {
      return badRequest(c, "conversationId is required");
    }

    return streamSSE(c, async (stream) => {
      const conv = await prisma.conversation.findFirst({
        select: { id: true },
        where: { id: conversationId, orgId },
      });
      if (!conv) {
        await stream.writeSSE({
          data: JSON.stringify({ code: "NOT_FOUND", message: "Conversation not found" }),
          event: "error",
        });
        return;
      }

      // Fire-and-forget write helper. We can't `await` inside the bus
      // subscriber (its contract returns void) or inside setInterval, and
      // stream closure mid-write throws — onAbort tears us down so the
      // swallowed error is safe here.
      const safeWrite = async (payload: { data: string; event?: string }): Promise<void> => {
        try {
          await stream.writeSSE(payload);
        } catch {
          /* stream closed mid-write — onAbort already tore us down */
        }
      };

      const unsubscribe = bus.subscribe(conversationId, (event) => {
        void safeWrite({ data: JSON.stringify(event), event: event.type });
      });

      // Initial handshake — lets the client confirm the stream is live
      // before the first real event arrives.
      await stream.writeSSE({ data: JSON.stringify({ conversationId }), event: "ready" });

      // Keep-alive frames keep proxies from closing the stream.
      const heartbeat = setInterval(() => {
        void safeWrite({ data: "ping" });
      }, 25_000);

      const teardown = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };

      // streamSSE keeps the response open until the callback returns. We
      // hold it open with a Promise that resolves when onAbort fires.
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
      teardown();
    });
  });

  // GET /web-chat/assets — list the org's brand assets (read-only).
  app.get("/assets", async (c) => {
    const orgId = c.get("orgId");
    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 50,
      limit: c.req.query("limit"),
      maxLimit: 200,
    });

    const rows = await prisma.brandAsset.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      where: {
        orgId,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
    });

    const response = buildListResponse(rows, limit);
    return c.json({
      items: response.items.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        metadata: row.metadata,
        mimeType: row.mimeType,
        size: row.size,
      })),
      nextCursor: response.nextCursor,
    });
  });

  // GET /web-chat/assets/:id — streams raw bytes from R2. The customer can
  // only fetch assets that belong to their org (orgId check in the where).
  app.get("/assets/:id", async (c) => {
    const orgId = c.get("orgId");
    const id = c.req.param("id");
    const row = await prisma.brandAsset.findFirst({
      where: { id, orgId },
    });
    if (!row) {
      return notFound(c, "Asset not found");
    }
    const bytes = await fetchAsset(row.r2Key);
    // Hono types BodyInit as ArrayBuffer-backed Uint8Array; the storage
    // layer returns Uint8Array<ArrayBufferLike> (Node SharedArrayBuffer
    // case). Narrow the view — the bytes are always ArrayBuffer-backed
    // here (R2 fetch + new Uint8Array).
    const bodyView = bytes as Uint8Array<ArrayBuffer>;
    return c.body(bodyView, 200, {
      "Cache-Control": "private, max-age=300",
      "Content-Type": row.mimeType,
    });
  });

  // GET /web-chat/activity — customer-facing slice of the org's activity
  // log. We surface only the events a customer should see: their own
  // messages, the agent's outbound replies, and agent run outcomes.
  // Operator-only events (INSTRUCTIONS_UPDATED, OWNER_COMMAND, etc.) stay
  // off this endpoint by design.
  app.get("/activity", async (c) => {
    const orgId = c.get("orgId");
    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 50,
      limit: c.req.query("limit"),
      maxLimit: 200,
    });

    const customerVisibleTypes = [
      "MESSAGE_INBOUND",
      "MESSAGE_OUTBOUND",
      "AGENT_RUN_STARTED",
      "AGENT_RUN_FINISHED",
      "AGENT_RUN_FAILED",
      "ACTION_EXECUTED",
      "ACTION_APPROVED",
    ] as const;

    const rows = await prisma.activityLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      where: {
        orgId,
        type: { in: [...customerVisibleTypes] },
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
    });

    const response = buildListResponse(rows, limit);
    return c.json({
      items: response.items.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        summary: row.summary,
        type: row.type,
      })),
      nextCursor: response.nextCursor,
    });
  });

  return app;
};

export { buildWebChatRoutes, ensureWebChatConnectorInstance };
export type { WebChatRouteDeps };
