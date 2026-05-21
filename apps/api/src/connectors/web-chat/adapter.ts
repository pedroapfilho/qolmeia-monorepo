import crypto from "node:crypto";

import type { PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";

import { webChatBus as defaultBus } from "@/lib/web-chat-bus";

import type { ConnectorAdapter, NormalizedAttachment, NormalizedMessage } from "../types";

// WEB_CHAT has no provider-side handshake — every message arrives via our
// own REST endpoint (POST /api/v1/web-chat/messages), so the adapter's
// parseInbound is mostly a shape-validator + uuid stamper. The route layer
// is responsible for constructing the raw body in a shape this adapter
// accepts, which keeps the pipeline contract identical to remote adapters.
type WebChatInboundRaw = {
  attachments?: ReadonlyArray<NormalizedAttachment>;
  authorDisplayName?: string | null;
  // The Conversation.id — WEB_CHAT uses it as both the threadId (no
  // provider chat to map onto) and as the lookup key for outbound writes.
  conversationId: string;
  text?: string | null;
};

// Outbound is fully owned by the adapter (no remote API call). The route
// layer hands us the threadId (Conversation.id) + payload; we persist a
// Message row and emit on the in-process pub/sub for SSE subscribers.
type WebChatBusLike = {
  publish: (event: {
    conversationId: string;
    message: {
      content: string;
      contentType: "AUDIO" | "DOCUMENT" | "IMAGE" | "TEXT";
      createdAt: string;
      id: string;
      metadata?: Record<string, unknown>;
      sender: "AGENT";
    };
    type: "message";
  }) => void;
};

type WebChatAdapterDeps = {
  bus?: WebChatBusLike;
  prisma?: Pick<PrismaClient, "message">;
  // Override for deterministic tests; production calls crypto.randomUUID().
  uuid?: () => string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isWebChatInboundRaw = (raw: unknown): raw is WebChatInboundRaw => {
  if (!isObject(raw)) {
    return false;
  }
  if (typeof raw.conversationId !== "string" || raw.conversationId.length === 0) {
    return false;
  }
  return true;
};

// WEB_CHAT has no API keys or per-connector secrets — every customer
// org gets one auto-provisioned ConnectorInstance with an empty config.
// Always returning valid keeps the connectors-config endpoints happy
// without forcing an empty-object validation rule.
const validateConfig: ConnectorAdapter["validateConfig"] = () => ({ valid: true });

const buildAdapter = (deps: WebChatAdapterDeps = {}): ConnectorAdapter => {
  const prisma = deps.prisma ?? defaultPrisma;
  const bus = deps.bus ?? defaultBus;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  const parseInboundPayload = (
    raw: unknown,
    _connectorConfig: unknown,
  ): Promise<NormalizedMessage> => {
    if (!isWebChatInboundRaw(raw)) {
      return Promise.reject(new Error("WebChat adapter: raw payload is not a valid inbound body"));
    }

    return Promise.resolve({
      attachments: raw.attachments ?? [],
      authorDisplayName: raw.authorDisplayName ?? null,
      // No provider-side id exists; we mint one so WebhookEvent dedupe still
      // works (every web-chat POST is a fresh externalId).
      externalId: uuid(),
      externalThreadId: raw.conversationId,
      rawTimestamp: Date.now(),
      text: raw.text ?? null,
    });
  };

  const sendOutbound: ConnectorAdapter["sendOutbound"] = async ({ payload, threadId }) => {
    const hasText = typeof payload.text === "string" && payload.text.length > 0;
    const files = payload.files ?? [];
    if (!hasText && files.length === 0) {
      throw new Error("WebChat adapter: payload requires text or at least one file");
    }

    // WEB_CHAT persists outbound directly to the Message table (no remote
    // provider). Files are recorded as IMAGE messages — the brand-asset
    // bytes already live in R2; metadata.assetFilename lets the client
    // request the bytes via /api/v1/web-chat/assets/:id.
    //
    // Multi-file outbound: in practice agent runs ship one image at a
    // time, but if multiple files arrive we persist each as its own row so
    // the SSE stream can render them progressively.
    let lastMessageId = "";

    if (hasText && payload.text) {
      const created = await prisma.message.create({
        data: {
          content: payload.text,
          contentType: "TEXT",
          conversationId: threadId,
          metadata: {},
          sender: "AGENT",
        },
        select: { content: true, createdAt: true, id: true, metadata: true },
      });
      lastMessageId = created.id;
      bus.publish({
        conversationId: threadId,
        message: {
          content: created.content,
          contentType: "TEXT",
          createdAt: created.createdAt.toISOString(),
          id: created.id,
          metadata: (created.metadata as Record<string, unknown> | null) ?? {},
          sender: "AGENT",
        },
        type: "message",
      });
    }

    // Folding so writes stay sequential (preserves order) without using
    // `await` in a loop body (lint rule).
    lastMessageId = await files.reduce<Promise<string>>(async (prev, file) => {
      const previousId = await prev;
      const created = await prisma.message.create({
        data: {
          content: file.filename,
          contentType: "IMAGE",
          conversationId: threadId,
          metadata: {
            filename: file.filename,
            mimeType: file.mimeType,
            sizeBytes: file.bytes.length,
          },
          sender: "AGENT",
        },
        select: { content: true, createdAt: true, id: true, metadata: true },
      });
      bus.publish({
        conversationId: threadId,
        message: {
          content: created.content,
          contentType: "IMAGE",
          createdAt: created.createdAt.toISOString(),
          id: created.id,
          metadata: (created.metadata as Record<string, unknown> | null) ?? {},
          sender: "AGENT",
        },
        type: "message",
      });
      return created.id || previousId;
    }, Promise.resolve(lastMessageId));

    if (!lastMessageId) {
      throw new Error("WebChat adapter: nothing was persisted");
    }
    return { externalMessageId: lastMessageId };
  };

  return {
    capabilities: { inbound: true, outbound: true },
    parseInboundPayload,
    sendOutbound,
    type: "WEB_CHAT",
    validateConfig,
  };
};

const webChatAdapter = buildAdapter();

export { buildAdapter, webChatAdapter };
export type { WebChatAdapterDeps, WebChatBusLike, WebChatInboundRaw };
