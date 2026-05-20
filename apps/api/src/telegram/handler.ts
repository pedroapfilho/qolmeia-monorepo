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
