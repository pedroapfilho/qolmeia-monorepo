import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { whatsappAdapter } from "./adapter";

const sampleTextWebhook = {
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ profile: { name: "Maria" }, wa_id: "5511999999999" }],
            messages: [
              {
                from: "5511999999999",
                id: "wamid.abc123",
                text: { body: "Olá, tudo bem?" },
                timestamp: "1716220800",
                type: "text",
              },
            ],
            metadata: { display_phone_number: "+55 11 99999-9999", phone_number_id: "pn_1" },
          },
        },
      ],
      id: "entry_1",
    },
  ],
  object: "whatsapp_business_account",
};

const sampleImageWebhook = {
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ profile: { name: "Maria" }, wa_id: "5511999999999" }],
            messages: [
              {
                from: "5511999999999",
                id: "wamid.img1",
                image: { caption: "Look", id: "media_xyz", mime_type: "image/jpeg" },
                timestamp: "1716220801",
                type: "image",
              },
            ],
          },
        },
      ],
      id: "entry_2",
    },
  ],
  object: "whatsapp_business_account",
};

const validConfig = {
  accessToken: "EAAGm0...",
  phoneNumberId: "pn_1",
  verifyToken: "verify_secret",
};

describe("whatsappAdapter.parseInboundPayload", () => {
  it("parses a Meta Cloud API text webhook into a NormalizedMessage", async () => {
    const result = await whatsappAdapter.parseInboundPayload(sampleTextWebhook, {});
    expect(result.externalId).toBe("wamid.abc123");
    expect(result.externalThreadId).toBe("5511999999999");
    expect(result.text).toBe("Olá, tudo bem?");
    expect(result.attachments).toHaveLength(0);
    expect(result.authorDisplayName).toBe("Maria");
    expect(result.rawTimestamp).toBe(1_716_220_800_000);
  });

  it("parses an image webhook with caption + attachment", async () => {
    const result = await whatsappAdapter.parseInboundPayload(sampleImageWebhook, {});
    expect(result.text).toBe("Look");
    expect(result.attachments).toEqual([{ kind: "image", mimeType: "image/jpeg", sizeBytes: 0 }]);
  });

  it("rejects payloads with the wrong object type", async () => {
    await expect(
      whatsappAdapter.parseInboundPayload({ entry: [], object: "page" }, {}),
    ).rejects.toThrow(/whatsapp_business_account/v);
  });

  it("rejects payloads with no messages", async () => {
    await expect(
      whatsappAdapter.parseInboundPayload(
        { entry: [{ changes: [{ value: {} }], id: "e" }], object: "whatsapp_business_account" },
        {},
      ),
    ).rejects.toThrow(/no messages/v);
  });
});

describe("whatsappAdapter.sendOutbound", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends text via the Cloud API and returns the message id", async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({ messages: [{ id: "wamid.outbound" }] }),
      ok: true,
      status: 200,
    });

    const result = await whatsappAdapter.sendOutbound({
      connectorConfig: validConfig,
      payload: { text: "Olá!" },
      threadId: "5511999999999",
    });

    expect(result.externalMessageId).toBe("wamid.outbound");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v18.0/pn_1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer EAAGm0...",
        "content-type": "application/json",
      }),
    );
    const body = JSON.parse(init.body as string) as {
      messaging_product: string;
      text: { body: string };
      to: string;
      type: string;
    };
    expect(body).toEqual({
      messaging_product: "whatsapp",
      text: { body: "Olá!" },
      to: "5511999999999",
      type: "text",
    });
  });

  it("rejects an invalid connector config", async () => {
    await expect(
      whatsappAdapter.sendOutbound({
        connectorConfig: { accessToken: "" },
        payload: { text: "hi" },
        threadId: "5511999999999",
      }),
    ).rejects.toThrow(/invalid connector config/v);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects file-only payloads in v0 (text-only outbound)", async () => {
    await expect(
      whatsappAdapter.sendOutbound({
        connectorConfig: validConfig,
        payload: {
          files: [{ bytes: new Uint8Array([1, 2, 3]), filename: "a.png", mimeType: "image/png" }],
        },
        threadId: "5511999999999",
      }),
    ).rejects.toThrow(/file outbound not implemented/v);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the Cloud API responds with HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({}),
      ok: false,
      status: 502,
    });
    await expect(
      whatsappAdapter.sendOutbound({
        connectorConfig: validConfig,
        payload: { text: "hi" },
        threadId: "5511999999999",
      }),
    ).rejects.toThrow(/HTTP 502/v);
  });
});

describe("whatsappAdapter.validateConfig", () => {
  it("accepts a complete config", () => {
    const result = whatsappAdapter.validateConfig({
      accessToken: "EAAGm0...",
      phoneNumberId: "1234567890",
      verifyToken: "secret",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects missing accessToken / phoneNumberId / verifyToken", () => {
    const result = whatsappAdapter.validateConfig({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("config.accessToken is required");
      expect(result.errors).toContain("config.phoneNumberId is required");
      expect(result.errors).toContain("config.verifyToken is required");
    }
  });
});

describe("whatsappAdapter.verifySignature", () => {
  it("accepts requests when appSecret is absent (lenient v0)", async () => {
    const result = await whatsappAdapter.verifySignature!({
      connectorConfig: validConfig,
      headers: new Headers(),
      rawBody: "{}",
    });
    expect(result).toBe(true);
  });

  it("rejects requests when appSecret is configured and signature is missing", async () => {
    const result = await whatsappAdapter.verifySignature!({
      connectorConfig: { ...validConfig, appSecret: "shhh" },
      headers: new Headers(),
      rawBody: "{}",
    });
    expect(result).toBe(false);
  });

  it("accepts requests with a valid HMAC SHA256 signature", async () => {
    const appSecret = "shhh";
    const body = JSON.stringify({ msg: "hi" });
    const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(body).digest("hex")}`;
    const result = await whatsappAdapter.verifySignature!({
      connectorConfig: { ...validConfig, appSecret },
      headers: new Headers({ "x-hub-signature-256": signature }),
      rawBody: body,
    });
    expect(result).toBe(true);
  });

  it("rejects requests with a tampered signature", async () => {
    const result = await whatsappAdapter.verifySignature!({
      connectorConfig: { ...validConfig, appSecret: "shhh" },
      headers: new Headers({ "x-hub-signature-256": "sha256=deadbeef" }),
      rawBody: "{}",
    });
    expect(result).toBe(false);
  });
});

describe("whatsappAdapter.verifyChallenge", () => {
  it("echoes the challenge when hub.verify_token matches", async () => {
    const query = new URLSearchParams({
      "hub.challenge": "12345",
      "hub.mode": "subscribe",
      "hub.verify_token": "verify_secret",
    });
    const result = await whatsappAdapter.verifyChallenge!({
      connectorConfig: validConfig,
      query,
    });
    expect(result).toEqual({ challenge: "12345", valid: true });
  });

  it("rejects when verify_token mismatches", async () => {
    const query = new URLSearchParams({
      "hub.challenge": "12345",
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
    });
    const result = await whatsappAdapter.verifyChallenge!({
      connectorConfig: validConfig,
      query,
    });
    expect(result).toEqual({ valid: false });
  });

  it("rejects when required query params are missing", async () => {
    const query = new URLSearchParams({ "hub.mode": "subscribe" });
    const result = await whatsappAdapter.verifyChallenge!({
      connectorConfig: validConfig,
      query,
    });
    expect(result).toEqual({ valid: false });
  });
});

describe("whatsappAdapter metadata", () => {
  it("declares inbound + outbound capabilities", () => {
    expect(whatsappAdapter.capabilities).toEqual({ inbound: true, outbound: true });
    expect(whatsappAdapter.type).toBe("WHATSAPP");
  });
});
