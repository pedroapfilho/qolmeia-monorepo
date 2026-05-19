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
  if (existing) {
    return;
  }
  await prisma.webhookEvent.create({
    data: { externalId: message.id, payload: { ...message } as unknown as object, provider: "telegram" },
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
      metadata: { attachments: message.attachments ?? [] } as unknown as object,
      sender: "CUSTOMER",
    },
  });

  // Skip extract if no audio AND text is empty/whitespace.
  const text = (message.text ?? "").trim();
  if (!hasAudio && text.length === 0) {
    const empty: SoulProfile = {};
    await thread.post(buildReply(empty, []));
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
