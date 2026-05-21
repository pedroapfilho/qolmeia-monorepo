import type { ConnectorAdapter, NormalizedAttachment, NormalizedMessage } from "../types";

// Minimal Telegram Bot API types — only the fields we read. Re-importing the
// chat SDK's internal types would couple us to its private surface; using
// shapes here lets us swap inbound transport later (drop chat SDK).
type TelegramPhotoSize = {
  file_id: string;
  file_size?: number;
  file_unique_id: string;
  height: number;
  width: number;
};

type TelegramAudio = {
  file_id: string;
  file_size?: number;
  file_unique_id: string;
  mime_type?: string;
};

type TelegramVoice = TelegramAudio;

type TelegramDocument = {
  file_id: string;
  file_name?: string;
  file_size?: number;
  file_unique_id: string;
  mime_type?: string;
};

type TelegramChat = {
  id: number;
  type: string;
};

type TelegramUser = {
  first_name: string;
  id: number;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  audio?: TelegramAudio;
  caption?: string;
  chat: TelegramChat;
  date: number;
  document?: TelegramDocument;
  from?: TelegramUser;
  message_id: number;
  photo?: ReadonlyArray<TelegramPhotoSize>;
  text?: string;
  voice?: TelegramVoice;
};

type TelegramUpdate = {
  channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  message?: TelegramMessage;
  update_id: number;
};

type TelegramConfig = {
  botToken: string;
  chatId?: string;
  secretToken: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTelegramMessage = (value: unknown): value is TelegramMessage => {
  if (!isObject(value)) {
    return false;
  }
  const chat = value.chat;
  if (!isObject(chat) || typeof chat.id !== "number") {
    return false;
  }
  if (typeof value.message_id !== "number") {
    return false;
  }
  if (typeof value.date !== "number") {
    return false;
  }
  return true;
};

const extractMessage = (update: TelegramUpdate): TelegramMessage | null =>
  update.message ?? update.edited_message ?? update.channel_post ?? null;

const buildAuthorDisplayName = (from: TelegramUser | undefined): string | null => {
  if (!from) {
    return null;
  }
  if (from.username) {
    return `@${from.username}`;
  }
  if (from.last_name) {
    return `${from.first_name} ${from.last_name}`;
  }
  return from.first_name;
};

const pickLargestPhoto = (
  photos: ReadonlyArray<TelegramPhotoSize>,
): TelegramPhotoSize | undefined => {
  if (photos.length === 0) {
    return undefined;
  }
  return photos.reduce((largest, current) =>
    (current.file_size ?? 0) > (largest.file_size ?? 0) ? current : largest,
  );
};

const buildAttachments = (message: TelegramMessage): ReadonlyArray<NormalizedAttachment> => {
  const attachments: Array<NormalizedAttachment> = [];

  if (message.photo && message.photo.length > 0) {
    const largest = pickLargestPhoto(message.photo);
    if (largest) {
      attachments.push({
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: largest.file_size ?? 0,
      });
    }
  }

  if (message.voice) {
    attachments.push({
      kind: "audio",
      mimeType: message.voice.mime_type ?? "audio/ogg",
      sizeBytes: message.voice.file_size ?? 0,
    });
  } else if (message.audio) {
    attachments.push({
      kind: "audio",
      mimeType: message.audio.mime_type ?? "audio/mpeg",
      sizeBytes: message.audio.file_size ?? 0,
    });
  }

  if (message.document) {
    attachments.push({
      kind: "document",
      mimeType: message.document.mime_type ?? "application/octet-stream",
      sizeBytes: message.document.file_size ?? 0,
    });
  }

  return attachments;
};

const parseInboundPayload = (
  raw: unknown,
  _connectorConfig: unknown,
): Promise<NormalizedMessage> => {
  if (!isObject(raw)) {
    return Promise.reject(new Error("Telegram adapter: raw payload is not an object"));
  }

  const update = raw as TelegramUpdate;
  const message = extractMessage(update);
  if (!message || !isTelegramMessage(message)) {
    return Promise.reject(new Error("Telegram adapter: update has no parseable message"));
  }

  const text = message.text ?? message.caption ?? null;
  const externalThreadId = String(message.chat.id);
  const externalId = `${externalThreadId}:${message.message_id}`;

  return Promise.resolve({
    attachments: buildAttachments(message),
    authorDisplayName: buildAuthorDisplayName(message.from),
    externalId,
    externalThreadId,
    // Telegram sends `date` in seconds; normalize to milliseconds.
    rawTimestamp: message.date * 1000,
    text,
  });
};

const isTelegramConfig = (config: unknown): config is TelegramConfig => {
  if (!isObject(config)) {
    return false;
  }
  if (typeof config.botToken !== "string" || config.botToken.length === 0) {
    return false;
  }
  if (typeof config.secretToken !== "string" || config.secretToken.length === 0) {
    return false;
  }
  return true;
};

const validateConfig: ConnectorAdapter["validateConfig"] = (config) => {
  const errors: Array<string> = [];
  if (!isObject(config)) {
    errors.push("config must be an object");
    return { errors, valid: false };
  }
  if (typeof config.botToken !== "string" || config.botToken.length === 0) {
    errors.push("config.botToken is required");
  }
  if (typeof config.secretToken !== "string" || config.secretToken.length === 0) {
    errors.push("config.secretToken is required");
  }
  if (errors.length > 0) {
    return { errors, valid: false };
  }
  return { valid: true };
};

type TelegramSendMessageResponse = {
  ok: boolean;
  result?: { message_id: number };
};

const sendText = async ({
  botToken,
  chatId,
  text,
}: {
  botToken: string;
  chatId: string;
  text: string;
}): Promise<number> => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    body: JSON.stringify({ chat_id: chatId, text }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as TelegramSendMessageResponse;
  if (!body.ok || !body.result) {
    throw new Error("Telegram sendMessage returned no result");
  }
  return body.result.message_id;
};

const sendFile = async ({
  botToken,
  chatId,
  file,
}: {
  botToken: string;
  chatId: string;
  file: { bytes: Uint8Array; filename: string; mimeType: string };
}): Promise<number> => {
  const form = new FormData();
  form.set("chat_id", chatId);
  // The Bot API treats anything non-text as a document upload; that's fine
  // for outbound — images/audio sent as docs preserve fidelity and avoid
  // the size limits of sendPhoto.
  // Cast to ArrayBuffer-backed view: Node's Uint8Array can be backed by
  // SharedArrayBuffer in some runtimes, but our `bytes` always come from
  // FS / fetch / TextEncoder, all of which are ArrayBuffer-backed. The
  // Blob constructor's BlobPart type narrows on this.
  const blobBytes = file.bytes as Uint8Array<ArrayBuffer>;
  const blob = new Blob([blobBytes], { type: file.mimeType });
  form.set("document", blob, file.filename);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    body: form,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Telegram sendDocument failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as TelegramSendMessageResponse;
  if (!body.ok || !body.result) {
    throw new Error("Telegram sendDocument returned no result");
  }
  return body.result.message_id;
};

const sendOutbound: ConnectorAdapter["sendOutbound"] = async ({
  connectorConfig,
  payload,
  threadId,
}) => {
  if (!isTelegramConfig(connectorConfig)) {
    throw new Error("Telegram adapter: invalid connector config");
  }
  const hasText = typeof payload.text === "string" && payload.text.length > 0;
  const files = payload.files ?? [];
  if (!hasText && files.length === 0) {
    throw new Error("Telegram adapter: payload requires text or at least one file");
  }

  const initial: Promise<number | undefined> =
    hasText && payload.text
      ? sendText({ botToken: connectorConfig.botToken, chatId: threadId, text: payload.text })
      : Promise.resolve(undefined);

  // Telegram preserves arrival order per chat. Folding over a single
  // promise chain keeps file uploads sequential without awaiting inside a
  // loop body (which the linter forbids).
  const lastMessageId = await files.reduce<Promise<number | undefined>>(
    (prev, file) =>
      prev.then(() =>
        sendFile({
          botToken: connectorConfig.botToken,
          chatId: threadId,
          file,
        }),
      ),
    initial,
  );

  if (lastMessageId === undefined) {
    throw new Error("Telegram adapter: nothing was sent");
  }
  return { externalMessageId: String(lastMessageId) };
};

// Telegram does not sign payloads; it uses a static secret token echoed back
// in the `X-Telegram-Bot-Api-Secret-Token` header. We compare it against the
// per-connector secret to reject spoofed webhooks.
const verifySignature: NonNullable<ConnectorAdapter["verifySignature"]> = ({
  connectorConfig,
  headers,
}) => {
  if (!isTelegramConfig(connectorConfig)) {
    return Promise.resolve(false);
  }
  const provided = headers.get("x-telegram-bot-api-secret-token");
  if (!provided) {
    return Promise.resolve(false);
  }
  return Promise.resolve(provided === connectorConfig.secretToken);
};

const telegramAdapter: ConnectorAdapter = {
  capabilities: { inbound: true, outbound: true },
  parseInboundPayload,
  sendOutbound,
  type: "TELEGRAM",
  validateConfig,
  verifySignature,
};

export type { TelegramConfig, TelegramMessage, TelegramUpdate };
export { telegramAdapter };
