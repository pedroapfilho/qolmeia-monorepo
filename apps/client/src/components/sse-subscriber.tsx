"use client";

import { useEffect } from "react";

import { API_URL } from "@/lib/api-client";
import type { SseEvent } from "@/lib/api-types";

type SseSubscriberProps = {
  conversationId: string | null;
  onEvent: (event: SseEvent) => void;
};

// Subscribes to /api/v1/web-chat/stream via the native EventSource API.
// The browser's EventSource sends cookies for same-origin requests; the
// API runs cross-origin so we explicitly opt in via `withCredentials`.
//
// We attach listeners for each known event type (message, agent-thinking,
// asset, ready) and dispatch them to the consumer via onEvent.
const SseSubscriber = ({ conversationId, onEvent }: SseSubscriberProps) => {
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const url = `${API_URL}/api/v1/web-chat/stream?conversationId=${encodeURIComponent(conversationId)}`;
    const source = new EventSource(url, { withCredentials: true });

    const handleMessage = (raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data) as Omit<SseEvent, "type"> & { type?: string };
        // EventSource strips the `event:` line from the data; we re-attach
        // the type so consumers can switch on it.
        onEvent({ ...(parsed as object), type: "message" } as SseEvent);
      } catch (error) {
        console.error("[sse] failed to parse message event", { error });
      }
    };
    const handleAgentThinking = (raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data) as Omit<SseEvent, "type"> & { type?: string };
        onEvent({ ...(parsed as object), type: "agent-thinking" } as SseEvent);
      } catch (error) {
        console.error("[sse] failed to parse agent-thinking event", { error });
      }
    };
    const handleAsset = (raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data) as Omit<SseEvent, "type"> & { type?: string };
        onEvent({ ...(parsed as object), type: "asset" } as SseEvent);
      } catch (error) {
        console.error("[sse] failed to parse asset event", { error });
      }
    };

    source.addEventListener("message", handleMessage);
    source.addEventListener("agent-thinking", handleAgentThinking);
    source.addEventListener("asset", handleAsset);

    // EventSource auto-reconnects on transient errors; we just log so
    // persistent failures show up in DevTools. Future iterations can
    // surface a "reconectando..." banner from readyState.
    const handleError = () => {
      console.error("[sse] error event");
    };
    source.addEventListener("error", handleError);

    return () => {
      source.close();
    };
  }, [conversationId, onEvent]);

  return null;
};

export { SseSubscriber };
