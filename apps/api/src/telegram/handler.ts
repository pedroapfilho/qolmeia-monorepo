import type { PrismaClient } from "@repo/db";

import type { AgentDispatcher } from "../agents/dispatcher";
import { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import { getBusinessContext as getBusinessContextDefault } from "../knowledge/provider";
import { logger } from "../lib/logger";
import { fetchAsset as fetchAssetDefault } from "../lib/storage";

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

type PostableFile = {
  data: Buffer | Uint8Array;
  filename: string;
  mimeType?: string;
};

type PostableMessage = {
  files?: ReadonlyArray<PostableFile>;
  markdown: string;
};

type IncomingThread = {
  id: string;
  post: (message: string | PostableMessage) => Promise<unknown>;
};

const extFromMime = (mimeType: string): string => {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }
  return "bin";
};

type HandlerDeps = {
  dispatcher: AgentDispatcher;
  fetchAsset?: typeof fetchAssetDefault;
  getBusinessContext?: typeof getBusinessContextDefault;
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
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
    dispatcher,
    fetchAsset: doFetch = fetchAssetDefault,
    getBusinessContext = getBusinessContextDefault,
    ingestBrandAsset = ingestBrandAssetDefault,
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
    const images = findImageAttachments(message.attachments ?? []);

    let contentType: "AUDIO" | "IMAGE" | "TEXT";
    if (hasAudio) {
      contentType = "AUDIO";
    } else if (images.length > 0) {
      contentType = "IMAGE";
    } else {
      contentType = "TEXT";
    }

    await prisma.message.create({
      data: {
        content: message.text ?? "",
        contentType,
        conversationId: conversation.id,
        externalId: message.id,
        metadata: toJsonSafe({ attachments: message.attachments ?? [] }) as object,
        sender: "CUSTOMER",
      },
    });

    // Pre-process image attachments: download → 20 MB check → ingest (sha256 + R2 + row).
    type ImageResult =
      | { assetId: string; bytes: Uint8Array; deduped: boolean; kind: "ok"; mimeType: string }
      | { kind: "oversize" }
      | { kind: "skip" };

    const processImage = async (img: IncomingAttachment): Promise<ImageResult> => {
      if (!img.fetchData) {
        return { kind: "skip" };
      }
      let bytes: Uint8Array;
      try {
        bytes = await img.fetchData();
      } catch (error) {
        logger.error({ chatId: thread.id, error, messageId: message.id }, "image.download_failed");
        return { kind: "skip" };
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return { kind: "oversize" };
      }
      const mimeType = img.mimeType ?? "application/octet-stream";
      try {
        const { assetId, deduped } = await ingestBrandAsset({
          bytes,
          mimeType,
          orgId: link.orgId,
          prisma,
        });
        return { assetId, bytes, deduped, kind: "ok", mimeType };
      } catch (error) {
        logger.error({ chatId: thread.id, error, messageId: message.id }, "image.ingest_failed");
        return { kind: "skip" };
      }
    };

    const imageResults = await Promise.allSettled(images.map(processImage));

    const newAssets: Array<{ assetId: string; deduped: boolean; mimeType: string }> = [];
    const imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }> = [];
    let oversizeCount = 0;

    for (const settled of imageResults) {
      if (settled.status === "rejected") {
        continue;
      }
      const r = settled.value;
      if (r.kind === "oversize") {
        oversizeCount += 1;
      } else if (r.kind === "ok") {
        newAssets.push({ assetId: r.assetId, deduped: r.deduped, mimeType: r.mimeType });
        if (!r.deduped) {
          imageBytes.push({ assetId: r.assetId, bytes: r.bytes, mimeType: r.mimeType });
        }
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
        logger.error({ chatId: thread.id, error, messageId: message.id }, "audio.download_failed");
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

    const result = await dispatcher.enqueueAndAwait({
      agentInstance,
      currentContext,
      dispatcher,
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

    const postImages = result.generatedAssetIds.map(async (assetId, i, arr) => {
      const isLast = i === arr.length - 1;
      try {
        const row = await prisma.brandAsset.findUnique({
          select: { mimeType: true, r2Key: true },
          where: { id: assetId },
        });
        if (!row) {
          return;
        }
        const bytes = await doFetch(row.r2Key);
        const filename = `qolmeia-${assetId}.${extFromMime(row.mimeType)}`;
        await thread.post({
          files: [{ data: Buffer.from(bytes), filename, mimeType: row.mimeType }],
          markdown: isLast ? result.text : "",
        });
      } catch (error) {
        logger.error({ assetId, chatId: thread.id, error }, "generated_image.post_failed");
        if (isLast) {
          try {
            await thread.post(result.text);
          } catch {
            /* already logged above */
          }
        }
      }
    });

    await (postImages.length > 0 ? Promise.allSettled(postImages) : thread.post(result.text));

    logger.info(
      {
        chatId: thread.id,
        generatedAssetIds: result.generatedAssetIds,
        messageId: message.id,
        newAssetIds: newAssets.map((a) => a.assetId),
        oversizeCount,
        replyLength: result.text.length,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
        toolCallSummary: result.toolCallSummary,
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
