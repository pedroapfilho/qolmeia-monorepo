import { describe, expect, it } from "vitest";

import { ADAPTERS, getAdapter } from "./registry";
import { telegramAdapter } from "./telegram/adapter";
import { NotImplementedError } from "./types";

describe("getAdapter", () => {
  it("returns telegramAdapter for TELEGRAM", () => {
    expect(getAdapter("TELEGRAM")).toBe(telegramAdapter);
  });

  it("returns an adapter for every ConnectorType enum variant", () => {
    const expectedVariants = [
      "FRESHA",
      "GOOGLE_MY_BUSINESS",
      "INSTAGRAM",
      "TELEGRAM",
      "WHATSAPP",
    ] as const;
    for (const variant of expectedVariants) {
      const adapter = ADAPTERS[variant];
      expect(adapter).toBeDefined();
      expect(adapter.type).toBe(variant);
    }
  });

  it("placeholder adapters throw NotImplementedError on parseInboundPayload", () => {
    expect(() => getAdapter("GOOGLE_MY_BUSINESS").parseInboundPayload({}, {})).toThrow(
      NotImplementedError,
    );
    expect(() => getAdapter("INSTAGRAM").parseInboundPayload({}, {})).toThrow(NotImplementedError);
  });

  it("placeholder adapters return invalid config validation", () => {
    const result = getAdapter("INSTAGRAM").validateConfig({});
    expect(result.valid).toBe(false);
  });
});
