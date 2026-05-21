import type { ConnectorType } from "@repo/db";

import { freshaAdapter } from "./fresha/adapter";
import { telegramAdapter } from "./telegram/adapter";
import type { ConnectorAdapter } from "./types";
import { NotImplementedError } from "./types";
import { webChatAdapter } from "./web-chat/adapter";
import { whatsappAdapter } from "./whatsapp/adapter";

// Placeholder used until a real adapter ships for a given ConnectorType.
// Keeping every enum value present means the registry record is total and
// `getAdapter` never returns undefined — callers can rely on `validateConfig`
// rejecting upfront instead of guarding against missing entries.
const buildUnimplementedAdapter = (type: ConnectorType, label: string): ConnectorAdapter => ({
  capabilities: { inbound: false, outbound: false },
  parseInboundPayload: () => {
    throw new NotImplementedError(label, "parseInboundPayload");
  },
  sendOutbound: () => {
    throw new NotImplementedError(label, "sendOutbound");
  },
  type,
  validateConfig: () => ({
    errors: [`${label} integration not yet implemented`],
    valid: false,
  }),
});

const ADAPTERS: Readonly<Record<ConnectorType, ConnectorAdapter>> = {
  FRESHA: freshaAdapter,
  GOOGLE_MY_BUSINESS: buildUnimplementedAdapter("GOOGLE_MY_BUSINESS", "GoogleMyBusiness"),
  INSTAGRAM: buildUnimplementedAdapter("INSTAGRAM", "Instagram"),
  TELEGRAM: telegramAdapter,
  // Customer-facing embedded chat surface used by apps/client. Inbound
  // arrives via POST /api/v1/web-chat/messages (not a remote webhook);
  // outbound persists Message rows + publishes on the in-process SSE bus
  // for live UI updates.
  WEB_CHAT: webChatAdapter,
  WHATSAPP: whatsappAdapter,
};

const getAdapter = (type: ConnectorType): ConnectorAdapter => {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`No adapter registered for ConnectorType: ${type}`);
  }
  return adapter;
};

export { ADAPTERS, getAdapter };
