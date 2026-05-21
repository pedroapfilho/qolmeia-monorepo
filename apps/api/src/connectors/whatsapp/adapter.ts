import type { ConnectorAdapter, NormalizedAttachment, NormalizedMessage } from "../types";
import { NotImplementedError } from "../types";

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

const sendOutbound: ConnectorAdapter["sendOutbound"] = () => {
  throw new NotImplementedError("WhatsApp", "sendOutbound");
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

const whatsappAdapter: ConnectorAdapter = {
  capabilities: { inbound: true, outbound: false },
  parseInboundPayload,
  sendOutbound,
  type: "WHATSAPP",
  validateConfig,
};

export type { WhatsAppConfig, WhatsAppMessage, WhatsAppWebhookPayload };
export { whatsappAdapter };
