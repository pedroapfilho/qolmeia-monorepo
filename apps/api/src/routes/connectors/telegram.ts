import { Hono } from "hono";

import { bot } from "../../telegram/bot";

const connectorsTelegramRoutes = new Hono();

// New URL shape: POST /connectors/telegram/:connectorInstanceId/webhook
//
// The :connectorInstanceId is informational for now — the Chat SDK adapter
// validates the secret token internally and the per-message chat ID
// identifies the org. Phase 5h+ may add per-route ConnectorInstance lookup
// for stricter access (e.g., rotate per-connector secret tokens).
//
// Coexists with the legacy POST /telegram/webhook route while orgs migrate.
connectorsTelegramRoutes.post("/telegram/:connectorInstanceId/webhook", (c) =>
  bot.webhooks.telegram(c.req.raw),
);

export { connectorsTelegramRoutes };
