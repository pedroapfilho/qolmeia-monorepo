import { telegramAdapter } from "@/connectors/telegram/adapter";
import type { ConnectorAdapter, ConnectorType } from "@/connectors/types";

// Registry of channel adapters. Total over the ConnectorType enum so the
// type system makes it impossible to forget one. P6 ships Telegram in full;
// WhatsApp / Slack / Discord throw NotImplemented at the adapter layer so
// the webhook route returns a clean 501 instead of silently dropping.
class NotImplementedAdapter implements ConnectorAdapter {
  constructor(public readonly type: ConnectorType) {}

  parseInbound(): Promise<null> {
    throw new Error(`${this.type} adapter is not implemented yet`);
  }

  resolveIdentity(): Promise<null> {
    throw new Error(`${this.type} adapter is not implemented yet`);
  }

  sendOutbound(): Promise<never> {
    throw new Error(`${this.type} adapter is not implemented yet`);
  }

  verify(): Promise<boolean> {
    throw new Error(`${this.type} adapter is not implemented yet`);
  }
}

const connectorRegistry: Record<ConnectorType, ConnectorAdapter> = {
  discord: new NotImplementedAdapter("discord"),
  slack: new NotImplementedAdapter("slack"),
  telegram: telegramAdapter,
  whatsapp: new NotImplementedAdapter("whatsapp"),
};

const isConnectorType = (value: string): value is ConnectorType =>
  value === "discord" || value === "slack" || value === "telegram" || value === "whatsapp";

const getAdapter = (type: string): ConnectorAdapter | null => {
  if (!isConnectorType(type)) {
    return null;
  }
  return connectorRegistry[type];
};

export { connectorRegistry, getAdapter, isConnectorType, NotImplementedAdapter };
