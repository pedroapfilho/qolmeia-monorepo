import { describe, expect, it } from "vitest";

import { NotImplementedError } from "../types";

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
  it("throws NotImplementedError", () => {
    expect(() =>
      whatsappAdapter.sendOutbound({
        connectorConfig: {},
        payload: { text: "hi" },
        threadId: "5511999999999",
      }),
    ).toThrow(NotImplementedError);
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

describe("whatsappAdapter metadata", () => {
  it("declares inbound-only capabilities", () => {
    expect(whatsappAdapter.capabilities).toEqual({ inbound: true, outbound: false });
    expect(whatsappAdapter.type).toBe("WHATSAPP");
  });
});
