import type { ConnectorType } from "@repo/db";

type NormalizedAttachment = {
  bytes?: Uint8Array;
  kind: "audio" | "document" | "image";
  mimeType?: string;
  sizeBytes: number;
  url?: string;
};

type NormalizedMessage = {
  attachments: ReadonlyArray<NormalizedAttachment>;
  authorDisplayName: string | null;
  // Provider-native message id (used to dedupe webhook deliveries).
  externalId: string;
  // Provider-native thread/chat id (Telegram chat id, WhatsApp wa_id, …).
  externalThreadId: string;
  // Unix milliseconds. Providers send seconds; adapters normalize to ms.
  rawTimestamp: number;
  text: string | null;
};

type OutboundFile = {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
};

type OutboundPayload = {
  files?: ReadonlyArray<OutboundFile>;
  text?: string;
};

type ConnectorCapabilities = {
  inbound: boolean;
  outbound: boolean;
};

type ConfigValidationResult = { valid: true } | { errors: ReadonlyArray<string>; valid: false };

type SendOutboundArgs = {
  // Adapter-specific config blob (per ConnectorInstance.config). Adapters
  // narrow it via their own type guards rather than relying on a global shape.
  connectorConfig: unknown;
  payload: OutboundPayload;
  threadId: string;
};

type VerifySignatureArgs = {
  connectorConfig: unknown;
  headers: Headers;
  rawBody: string;
};

type VerifyChallengeArgs = {
  connectorConfig: unknown;
  query: URLSearchParams;
};

type VerifyChallengeResult = { challenge?: string; valid: boolean };

type ConnectorAdapter = {
  capabilities: ConnectorCapabilities;
  parseInboundPayload: (raw: unknown, connectorConfig: unknown) => Promise<NormalizedMessage>;
  sendOutbound: (args: SendOutboundArgs) => Promise<{ externalMessageId: string }>;
  type: ConnectorType;
  validateConfig: (config: unknown) => ConfigValidationResult;
  // Optional inbound webhook hooks. When absent, the generic route handler
  // skips signature verification (open) and replies 200 OK without echoing a
  // challenge (for channels that don't need a verification handshake).
  verifyChallenge?: (args: VerifyChallengeArgs) => Promise<VerifyChallengeResult>;
  verifySignature?: (args: VerifySignatureArgs) => Promise<boolean>;
};

class NotImplementedError extends Error {
  constructor(adapterType: string, method: string) {
    super(`${adapterType} adapter: ${method} is not implemented`);
    this.name = "NotImplementedError";
  }
}

export type {
  ConfigValidationResult,
  ConnectorAdapter,
  ConnectorCapabilities,
  NormalizedAttachment,
  NormalizedMessage,
  OutboundFile,
  OutboundPayload,
  SendOutboundArgs,
  VerifyChallengeArgs,
  VerifyChallengeResult,
  VerifySignatureArgs,
};
export { NotImplementedError };
