import { dispatch } from "@flue/runtime";
import { Hono } from "hono";

import { getAdapter, isConnectorType } from "#/connectors/registry";
import { upsertConversation } from "#/db/schema";
import { getConnectorSecrets } from "#/lib/connector-secrets";
import { logError } from "#/lib/logger";

// Universal webhook endpoint. The stateless Worker is the router (spec
// decision 7) — no per-channel DO. Telegram and any future provider hit the
// same path; the adapter normalizes the payload and the Correspondent DO
// gets a uniform NormalizedMessage.

type ConnectorRow = {
  company_id: string;
  config_ref: string;
  status: string;
  type: string;
};

const webhooksRoutes = new Hono<{ Bindings: Env }>();

webhooksRoutes.post("/:type/:connectorId", async (c) => {
  const { connectorId, type } = c.req.param();

  if (!isConnectorType(type)) {
    return c.text("Unknown connector type", 404);
  }
  const adapter = getAdapter(type);
  if (!adapter) {
    return c.text("Unknown connector type", 404);
  }

  // Load the connector row (gated by id + type so a token for one type
  // can't be used against another).
  const connector = await c.env.DB.prepare(
    "SELECT type, status, config_ref, company_id FROM connector WHERE id = ?",
  )
    .bind(connectorId)
    .first<ConnectorRow>();
  if (!connector || connector.type !== type || connector.status !== "active") {
    return c.text("Connector not found", 404);
  }

  const config = await getConnectorSecrets(c.env, connectorId);
  if (!config) {
    return c.text("Connector misconfigured", 503);
  }

  // Read the body once for verify + parse.
  const rawBody = await c.req.text();

  const verified = await adapter.verify({ body: rawBody, headers: c.req.raw.headers }, config);
  if (!verified) {
    return c.text("Signature mismatch", 401);
  }

  const normalized = await adapter.parseInbound(rawBody, config);
  if (!normalized) {
    // Receipts, typing indicators, anything we don't act on — 200 + stop.
    return c.text("OK", 200);
  }

  // Idempotency: same provider + externalId on a redelivery short-circuits.
  // The PK constraint surfaces as an error on D1; INSERT OR IGNORE makes
  // re-runs cheap.
  const insertResult = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_event (provider, external_id, received_at) VALUES (?, ?, ?)",
  )
    .bind(type, normalized.externalId, Date.now())
    .run();
  if ((insertResult.meta?.changes ?? 0) === 0) {
    return c.text("Already processed", 200);
  }

  // Upsert the conversation row so the Correspondent's persistence has a
  // foreign key to land on.
  const conversationId = `${type}-${connector.company_id}-${normalized.externalThreadId}`;
  await upsertConversation(c.env.DB, {
    companyId: connector.company_id,
    externalThreadId: normalized.externalThreadId,
    id: conversationId,
  });

  // Async handoff — return 200 to the provider immediately, dispatch the inbound
  // message to the Correspondent agent in the background.
  // NOTE: the agent's reply currently streams to the web chat (SSE); routing it
  // back to the connector (e.g. a Telegram reply) is deferred until rebuilt on
  // Flue channels (/channels/:name).
  if (normalized.text) {
    // Best-effort fire-and-forget: a dispatch failure must never surface as an
    // uncaught rejection in waitUntil — log it and move on.
    c.executionCtx.waitUntil(
      dispatch({
        agent: "correspondent",
        id: connector.company_id,
        input: { message: normalized.text },
      }).catch((error: unknown) =>
        logError("connector.dispatch.err", {
          companyId: connector.company_id,
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
  }

  return c.text("OK", 200);
});

export { webhooksRoutes };
