import type {
  ConnectorAdapter,
  NormalizedMessage,
  ResolveIdentityResult,
  SendOutboundArgs,
  SendOutboundResult,
  VerifyRequest,
} from "@/connectors/types";

// Telegram Bot API. Inbound: POST /webhooks/telegram/:connectorId with a
// `Update` payload. Outbound: POST https://api.telegram.org/bot<token>/
// sendMessage. Verify: `X-Telegram-Bot-Api-Secret-Token` header matches the
// connector's stored secret_token.
//
// Telegram-specific fields the adapter cares about:
//   secret_token  — verification header (per webhook)
//   bot_token     — used in the API URL for outbound
const TELEGRAM_API_BASE = "https://api.telegram.org";

type TelegramConfig = {
  bot_token?: string;
  secret_token?: string;
};

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    date?: number;
    from?: { first_name?: string; last_name?: string; username?: string };
    message_id?: number;
    text?: string;
    voice?: { file_id?: string; mime_type?: string };
  };
  update_id?: number;
};

const asConfig = (raw: Record<string, unknown>): TelegramConfig => ({
  bot_token: typeof raw.bot_token === "string" ? raw.bot_token : undefined,
  secret_token: typeof raw.secret_token === "string" ? raw.secret_token : undefined,
});

const safeParse = (body: string): TelegramUpdate | null => {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as TelegramUpdate) : null;
  } catch {
    return null;
  }
};

const displayName = (
  from?: TelegramUpdate["message"] extends infer T
    ? T extends { from?: infer F }
      ? F
      : never
    : never,
): string | undefined => {
  if (!from || typeof from !== "object") {
    return undefined;
  }
  const f = from as { first_name?: string; last_name?: string; username?: string };
  if (f.first_name || f.last_name) {
    return [f.first_name, f.last_name].filter(Boolean).join(" ").trim() || undefined;
  }
  return f.username;
};

const telegramAdapter: ConnectorAdapter = {
  parseInbound(
    rawBody: string,
    _config: Record<string, unknown>,
  ): Promise<NormalizedMessage | null> {
    const update = safeParse(rawBody);
    const message = update?.message;
    if (!update || !message || !message.chat?.id || message.message_id === undefined) {
      return Promise.resolve(null);
    }
    const text = message.text ?? "";
    const externalThreadId = String(message.chat.id);
    const externalId = `${externalThreadId}:${message.message_id}`;
    const timestamp = (message.date ?? Math.floor(Date.now() / 1000)) * 1000;

    return Promise.resolve({
      attachments: message.voice
        ? [
            {
              externalId: message.voice.file_id,
              kind: "audio",
              mime: message.voice.mime_type ?? "audio/ogg",
            },
          ]
        : [],
      authorDisplayName: displayName(message.from),
      externalId,
      externalThreadId,
      text,
      timestamp,
    });
  },

  resolveIdentity(
    rawBody: string,
    _config: Record<string, unknown>,
  ): Promise<ResolveIdentityResult | null> {
    const update = safeParse(rawBody);
    const message = update?.message;
    if (!message?.chat?.id) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      authorDisplayName: displayName(message.from),
      externalThreadId: String(message.chat.id),
    });
  },

  async sendOutbound(args: SendOutboundArgs): Promise<SendOutboundResult> {
    const config = asConfig(args.config);
    if (!config.bot_token) {
      throw new Error("Telegram connector config missing bot_token");
    }
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${config.bot_token}/sendMessage`, {
      body: JSON.stringify({
        chat_id: args.externalThreadId,
        parse_mode: "Markdown",
        text: args.text,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram sendMessage HTTP ${response.status}: ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as { result?: { message_id?: number } };
    const id = json.result?.message_id;
    if (id === undefined) {
      throw new Error("Telegram sendMessage response missing result.message_id");
    }
    return { externalMessageId: `${args.externalThreadId}:${id}` };
  },

  type: "telegram",

  verify(request: VerifyRequest, config: Record<string, unknown>): Promise<boolean> {
    const expected = asConfig(config).secret_token;
    if (!expected) {
      // No secret configured → reject. Operator must set one on the connector.
      return Promise.resolve(false);
    }
    const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    return Promise.resolve(got === expected);
  },
};

export { telegramAdapter };
