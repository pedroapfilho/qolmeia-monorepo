// Connector secrets live in a single KV namespace keyed by `connector.id`.
// One Worker binding scales to N companies × N channels without binding
// explosion. The `connector` D1 row holds `config_ref = "kv:<connector_id>"`
// so the resolver knows where to look. Miniflare emulates KV locally.

type ConnectorSecretEnv = { CONNECTOR_SECRETS: KVNamespace };

const keyFor = (connectorId: string): string => `connector:${connectorId}`;

const getConnectorSecrets = async (
  env: ConnectorSecretEnv,
  connectorId: string,
): Promise<Record<string, unknown> | null> => {
  const raw = await env.CONNECTOR_SECRETS.get(keyFor(connectorId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const putConnectorSecrets = async (
  env: ConnectorSecretEnv,
  connectorId: string,
  config: Record<string, unknown>,
): Promise<void> => {
  await env.CONNECTOR_SECRETS.put(keyFor(connectorId), JSON.stringify(config));
};

export { getConnectorSecrets, putConnectorSecrets };
