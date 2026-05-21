import { describe, expect, it, vi } from "vitest";

import { buildBus } from "./web-chat-bus";

describe("web-chat-bus", () => {
  it("delivers a message event to a subscriber on the matching conversation", () => {
    const bus = buildBus();
    const handler = vi.fn();
    bus.subscribe("conv_1", handler);

    bus.publish({
      conversationId: "conv_1",
      message: {
        content: "olá",
        contentType: "TEXT",
        createdAt: "2026-05-21T00:00:00.000Z",
        id: "msg_1",
        sender: "AGENT",
      },
      type: "message",
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      conversationId: "conv_1",
      message: {
        content: "olá",
        contentType: "TEXT",
        createdAt: "2026-05-21T00:00:00.000Z",
        id: "msg_1",
        sender: "AGENT",
      },
      type: "message",
    });
  });

  it("does not deliver events to subscribers on a different conversation", () => {
    const bus = buildBus();
    const handler = vi.fn();
    bus.subscribe("conv_1", handler);

    bus.publish({
      conversationId: "conv_2",
      message: {
        content: "outro",
        contentType: "TEXT",
        createdAt: "2026-05-21T00:00:00.000Z",
        id: "msg_2",
        sender: "AGENT",
      },
      type: "message",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers agent-thinking events", () => {
    const bus = buildBus();
    const handler = vi.fn();
    bus.subscribe("conv_1", handler);

    bus.publish({
      agentDisplayName: "Designer",
      conversationId: "conv_1",
      type: "agent-thinking",
    });

    expect(handler).toHaveBeenCalledWith({
      agentDisplayName: "Designer",
      conversationId: "conv_1",
      type: "agent-thinking",
    });
  });

  it("unsubscribe stops further deliveries", () => {
    const bus = buildBus();
    const handler = vi.fn();
    const off = bus.subscribe("conv_1", handler);
    off();

    bus.publish({
      conversationId: "conv_1",
      message: {
        content: "depois",
        contentType: "TEXT",
        createdAt: "2026-05-21T00:00:00.000Z",
        id: "msg_3",
        sender: "AGENT",
      },
      type: "message",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers on the same conversation", () => {
    const bus = buildBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe("conv_1", a);
    bus.subscribe("conv_1", b);

    bus.publish({
      assetId: "asset_1",
      conversationId: "conv_1",
      type: "asset",
    });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("reports subscriber count per conversation", () => {
    const bus = buildBus();
    expect(bus.subscriberCount("conv_1")).toBe(0);

    const off = bus.subscribe("conv_1", vi.fn());
    expect(bus.subscriberCount("conv_1")).toBe(1);
    expect(bus.subscriberCount("conv_other")).toBe(0);

    off();
    expect(bus.subscriberCount("conv_1")).toBe(0);
  });
});
