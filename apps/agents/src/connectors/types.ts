// The uniform ConnectorAdapter contract. Every channel — web chat, Telegram,
// WhatsApp, Slack, Discord — implements the same shape. The Correspondent
// never knows which channel it is talking to; transport differences live
// inside adapters, never above the NormalizedMessage line (spec decision 7).

type ConnectorType = "discord" | "slack" | "telegram" | "whatsapp";

type AttachmentKind = "audio" | "document" | "image";

type Attachment = {
  externalId?: string;
  kind: AttachmentKind;
  mime?: string;
  url?: string;
};

type NormalizedMessage = {
  attachments: ReadonlyArray<Attachment>;
  authorDisplayName?: string;
  externalId: string;
  externalThreadId: string;
  text: string;
  timestamp: number;
};

type SendOutboundArgs = {
  config: Record<string, unknown>;
  externalThreadId: string;
  text: string;
};

type SendOutboundResult = { externalMessageId: string };

type ResolveIdentityResult = {
  authorDisplayName?: string;
  externalThreadId: string;
};

type VerifyRequest = {
  body: string;
  headers: Headers;
};

type ConnectorAdapter = {
  parseInbound(rawBody: string, config: Record<string, unknown>): Promise<NormalizedMessage | null>;
  resolveIdentity(rawBody: string, config: Record<string, unknown>): Promise<ResolveIdentityResult | null>;
  sendOutbound(args: SendOutboundArgs): Promise<SendOutboundResult>;
  type: ConnectorType;
  verify(request: VerifyRequest, config: Record<string, unknown>): Promise<boolean>;
};

export type {
  Attachment,
  AttachmentKind,
  ConnectorAdapter,
  ConnectorType,
  NormalizedMessage,
  ResolveIdentityResult,
  SendOutboundArgs,
  SendOutboundResult,
  VerifyRequest,
};
