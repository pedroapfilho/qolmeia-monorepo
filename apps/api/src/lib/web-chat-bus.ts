import { EventEmitter } from "node:events";

// Single-process pub/sub for WEB_CHAT live updates. Scale assumption: v0
// runs in one API process; a future deployment with N replicas will need
// to swap this for Redis pub/sub (the surface is intentionally small so
// the migration touches one file).
//
// Channel topology: one logical "channel" per conversationId. We use a
// single EventEmitter and namespace events with the conversationId — this
// keeps subscribe/publish O(1) without needing per-conversation emitters.
type WebChatMessageEvent = {
  conversationId: string;
  message: {
    content: string;
    contentType: "AUDIO" | "DOCUMENT" | "IMAGE" | "TEXT";
    createdAt: string;
    id: string;
    metadata?: Record<string, unknown>;
    sender: "AGENT" | "CUSTOMER" | "SYSTEM";
  };
  type: "message";
};

type WebChatAgentThinkingEvent = {
  agentDisplayName: string;
  conversationId: string;
  type: "agent-thinking";
};

type WebChatAssetEvent = {
  assetId: string;
  conversationId: string;
  type: "asset";
};

type WebChatEvent = WebChatAgentThinkingEvent | WebChatAssetEvent | WebChatMessageEvent;

type WebChatSubscriber = (event: WebChatEvent) => void;

// `setMaxListeners` defaults to 10 in Node — bump it because every SSE
// client opens a long-lived listener. Hitting 10 is realistic with even
// a small number of concurrent customer tabs.
const channelFor = (conversationId: string): string => `conversation:${conversationId}`;

const buildBus = () => {
  // Node EventEmitter exposes listenerCount() + on/off ergonomics we rely
  // on. EventTarget (the unicorn-preferred shape) would force us to roll
  // our own dispatch table and lose subscriberCount().
  // oxlint-disable-next-line prefer-event-target
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const subscribe = (conversationId: string, onEvent: WebChatSubscriber): (() => void) => {
    const channel = channelFor(conversationId);
    emitter.on(channel, onEvent);
    // Returning an unsubscribe closure keeps the cleanup paired with the
    // subscribe call site — handlers don't have to know the channel key.
    return () => {
      emitter.off(channel, onEvent);
    };
  };

  const publish = (event: WebChatEvent): void => {
    emitter.emit(channelFor(event.conversationId), event);
  };

  // Exposed for tests + ops introspection. EventEmitter.listenerCount is
  // O(1) and returns 0 for unknown channels.
  const subscriberCount = (conversationId: string): number =>
    emitter.listenerCount(channelFor(conversationId));

  return { publish, subscribe, subscriberCount };
};

const webChatBus = buildBus();

export { buildBus, webChatBus };
export type {
  WebChatAgentThinkingEvent,
  WebChatAssetEvent,
  WebChatEvent,
  WebChatMessageEvent,
  WebChatSubscriber,
};
