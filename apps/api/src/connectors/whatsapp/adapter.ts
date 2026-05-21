import crypto from "node:crypto";

import type { ConnectorAdapter, NormalizedAttachment, NormalizedMessage } from "../types";

// Meta Cloud API webhook shapes — only the fields the parser consumes.
// Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
type WhatsAppContactProfile = {
  name?: string;
};

type WhatsAppContact = {
  profile?: WhatsAppContactProfile;
  wa_id: string;
};

type WhatsAppTextBody = {
  body: string;
};

type WhatsAppMediaRef = {
  id: string;
  mime_type?: string;
  sha256?: string;
};

type WhatsAppImagePayload = WhatsAppMediaRef & { caption?: string };

type WhatsAppDocumentPayload = WhatsAppMediaRef & {
  caption?: string;
  filename?: string;
};

type WhatsAppMessage = {
  audio?: WhatsAppMediaRef;
  document?: WhatsAppDocumentPayload;
  from: string;
  id: string;
  image?: WhatsAppImagePayload;
  text?: WhatsAppTextBody;
  // Unix seconds, as string per Cloud API docs.
  timestamp: string;
  type: string;
  voice?: WhatsAppMediaRef;
};

type WhatsAppValue = {
  contacts?: ReadonlyArray<WhatsAppContact>;
  messages?: ReadonlyArray<WhatsAppMessage>;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
};

type WhatsAppChange = {
  field?: string;
  value: WhatsAppValue;
};

type WhatsAppEntry = {
  changes: ReadonlyArray<WhatsAppChange>;
  id: string;
};

type WhatsAppWebhookPayload = {
  entry: ReadonlyArray<WhatsAppEntry>;
  object: string;
};

type WhatsAppConfig = {
  accessToken: string;
  // Meta App Secret used to verify the X-Hub-Signature-256 header. Optional
  // for v0 — when absent, signature verification is skipped so operators can
  // register the webhook before pasting the secret.
  appSecret?: string;
  phoneNumberId: string;
  verifyToken: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const findFirstMessage = (
  payload: WhatsAppWebhookPayload,
): { contact?: WhatsAppContact; message: WhatsAppMessage } | null => {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const message = value.messages?.[0];
      if (message) {
        const contact = value.contacts?.find((c) => c.wa_id === message.from);
        return { contact, message };
      }
    }
  }
  return null;
};

const buildAttachment = (message: WhatsAppMessage): NormalizedAttachment | null => {
  if (message.image) {
    return { kind: "image", mimeType: message.image.mime_type, sizeBytes: 0 };
  }
  if (message.voice) {
    return { kind: "audio", mimeType: message.voice.mime_type ?? "audio/ogg", sizeBytes: 0 };
  }
  if (message.audio) {
    return { kind: "audio", mimeType: message.audio.mime_type, sizeBytes: 0 };
  }
  if (message.document) {
    return {
      kind: "document",
      mimeType: message.document.mime_type ?? "application/octet-stream",
      sizeBytes: 0,
    };
  }
  return null;
};

const parseInboundPayload: ConnectorAdapter["parseInboundPayload"] = (raw, _connectorConfig) => {
  if (!isObject(raw)) {
    return Promise.reject(new Error("WhatsApp adapter: raw payload is not an object"));
  }
  const payload = raw as WhatsAppWebhookPayload;
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return Promise.reject(
      new Error("WhatsApp adapter: payload is not a whatsapp_business_account webhook"),
    );
  }

  const found = findFirstMessage(payload);
  if (!found) {
    return Promise.reject(new Error("WhatsApp adapter: payload has no messages"));
  }

  const { contact, message } = found;
  const text = message.text?.body ?? message.image?.caption ?? message.document?.caption ?? null;
  const attachment = buildAttachment(message);
  const result: NormalizedMessage = {
    attachments: attachment ? [attachment] : [],
    authorDisplayName: contact?.profile?.name ?? null,
    externalId: message.id,
    externalThreadId: message.from,
    // Cloud API ships timestamp as a stringified unix-seconds value.
    rawTimestamp: Number.parseInt(message.timestamp, 10) * 1000,
    text,
  };
  return Promise.resolve(result);
};

const isWhatsAppConfig = (config: unknown): config is WhatsAppConfig => {
  if (!isObject(config)) {
    return false;
  }
  if (typeof config.accessToken !== "string" || config.accessToken.length === 0) {
    return false;
  }
  if (typeof config.phoneNumberId !== "string" || config.phoneNumberId.length === 0) {
    return false;
  }
  if (typeof config.verifyToken !== "string" || config.verifyToken.length === 0) {
    return false;
  }
  return true;
};

type WhatsAppSendResponse = {
  messages?: ReadonlyArray<{ id: string }>;
};

// Meta Cloud API uses graph.facebook.com/<version>/<phone_number_id>/messages.
// v18.0 is the lowest version this code path was tested against; pinning the
// version explicitly avoids silent breaking changes when Meta promotes the
// "latest" alias.
const META_API_VERSION = "v18.0";

const sendText = async ({
  accessToken,
  phoneNumberId,
  text,
  threadId,
}: {
  accessToken: string;
  phoneNumberId: string;
  text: string;
  threadId: string;
}): Promise<string> => {
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
    {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        text: { body: text },
        to: threadId,
        type: "text",
      }),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(`WhatsApp sendMessage failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as WhatsAppSendResponse;
  const messageId = body.messages?.[0]?.id;
  if (!messageId) {
    throw new Error("WhatsApp sendMessage returned no message id");
  }
  return messageId;
};

const sendOutbound: ConnectorAdapter["sendOutbound"] = async ({
  connectorConfig,
  payload,
  threadId,
}) => {
  if (!isWhatsAppConfig(connectorConfig)) {
    throw new Error("WhatsApp adapter: invalid connector config");
  }
  const hasText = typeof payload.text === "string" && payload.text.length > 0;
  if (!hasText) {
    // File uploads require a two-step flow (POST /media for the upload,
    // then POST /messages with the returned media id). v0 only ships text;
    // adding media is a follow-up — see Meta's media-upload docs.
    throw new Error("WhatsApp adapter: file outbound not implemented (text-only in v0)");
  }
  const messageId = await sendText({
    accessToken: connectorConfig.accessToken,
    phoneNumberId: connectorConfig.phoneNumberId,
    text: payload.text ?? "",
    threadId,
  });
  return { externalMessageId: messageId };
};

const validateConfig: ConnectorAdapter["validateConfig"] = (config) => {
  const errors: Array<string> = [];
  if (!isObject(config)) {
    return { errors: ["config must be an object"], valid: false };
  }
  if (typeof config.accessToken !== "string" || config.accessToken.length === 0) {
    errors.push("config.accessToken is required");
  }
  if (typeof config.phoneNumberId !== "string" || config.phoneNumberId.length === 0) {
    errors.push("config.phoneNumberId is required");
  }
  if (typeof config.verifyToken !== "string" || config.verifyToken.length === 0) {
    errors.push("config.verifyToken is required");
  }
  if (errors.length > 0) {
    return { errors, valid: false };
  }
  return { valid: true };
};

const readAppSecret = (connectorConfig: unknown): string | null => {
  if (!isObject(connectorConfig)) {
    return null;
  }
  if (typeof connectorConfig.appSecret === "string" && connectorConfig.appSecret.length > 0) {
    return connectorConfig.appSecret;
  }
  return null;
};

const readVerifyToken = (connectorConfig: unknown): string | null => {
  if (!isObject(connectorConfig)) {
    return null;
  }
  if (typeof connectorConfig.verifyToken === "string" && connectorConfig.verifyToken.length > 0) {
    return connectorConfig.verifyToken;
  }
  return null;
};

// HMAC-SHA256 verification of the X-Hub-Signature-256 header. Returns true
// when appSecret is absent (lenient v0 — operators can register the webhook
// before pasting the secret); when present, the comparison is constant-time.
const verifySignature: NonNullable<ConnectorAdapter["verifySignature"]> = ({
  connectorConfig,
  headers,
  rawBody,
}) => {
  const appSecret = readAppSecret(connectorConfig);
  if (!appSecret) {
    return Promise.resolve(true);
  }
  const signatureHeader = headers.get("x-hub-signature-256");
  if (!signatureHeader) {
    return Promise.resolve(false);
  }
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return Promise.resolve(false);
  }
  const provided = signatureHeader.slice(prefix.length);
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) {
    return Promise.resolve(false);
  }
  try {
    return Promise.resolve(
      crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex")),
    );
  } catch {
    return Promise.resolve(false);
  }
};

// Meta's hub.verify_token handshake. Dashboard hits the URL with
// hub.mode=subscribe + hub.verify_token + hub.challenge; we echo the challenge
// when the token matches the ConnectorInstance config.
const verifyChallenge: NonNullable<ConnectorAdapter["verifyChallenge"]> = ({
  connectorConfig,
  query,
}) => {
  const mode = query.get("hub.mode");
  const verifyToken = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");
  if (mode !== "subscribe" || !verifyToken || !challenge) {
    return Promise.resolve({ valid: false });
  }
  const expected = readVerifyToken(connectorConfig);
  if (!expected || expected !== verifyToken) {
    return Promise.resolve({ valid: false });
  }
  return Promise.resolve({ challenge, valid: true });
};

const whatsappAdapter: ConnectorAdapter = {
  capabilities: { inbound: true, outbound: true },
  parseInboundPayload,
  sendOutbound,
  type: "WHATSAPP",
  validateConfig,
  verifyChallenge,
  verifySignature,
};

export type { WhatsAppConfig, WhatsAppMessage, WhatsAppWebhookPayload };
export { whatsappAdapter };
