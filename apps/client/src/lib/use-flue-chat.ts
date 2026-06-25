"use client";

import {
  type AgentPromptImage,
  type AttachedAgentEvent,
  createFlueClient,
  type FlueClient,
} from "@flue/sdk";
import type { FileUIPart } from "ai";
import { useCallback, useMemo, useRef, useState } from "react";

// A chat message in the shape the Chat UI renders: an id, a role, and an
// ordered list of text/file parts. Mirrors the slice of the AI SDK's
// `UIMessage` the JSX touches so the view layer is untouched by the transport
// swap.
type ChatMessagePart =
  | { text: string; type: "text" }
  | { filename?: string; mediaType: string; type: "file"; url: string };

type ChatMessage = {
  id: string;
  parts: Array<ChatMessagePart>;
  role: "assistant" | "user";
};

// Same set the AI SDK's `ChatStatus` uses, so the composer/prompt-input keep
// compiling against it.
type FlueChatStatus = "error" | "ready" | "streaming" | "submitted";

type SendInput = {
  files: Array<FileUIPart>;
  text: string;
};

type UseFlueChatOptions = {
  agent: "correspondent" | "planner";
  // Worker origin. Empty string ("" / same-origin) resolves the SDK's relative
  // baseUrl against `window.location.origin`; a non-empty value targets a
  // cross-origin prod Worker.
  baseUrl: string;
  companyId: string;
  onError?: (error: unknown) => void;
  // Validated by the Worker as a fallback when the first-party cookie is absent
  // (e.g. cross-origin prod). Same-origin dev relies on the cookie.
  sessionToken?: string;
};

type UseFlueChatResult = {
  kickoff: (prompt: string) => Promise<void>;
  messages: Array<ChatMessage>;
  sendMessage: (input: SendInput) => Promise<void>;
  status: FlueChatStatus;
};

let messageSeq = 0;
const nextMessageId = (prefix: string): string => {
  messageSeq += 1;
  return `${prefix}-${messageSeq}-${Date.now()}`;
};

// The visible assistant text arrives as a stream of `text_delta` events between
// a `message_start` (role: "assistant") and the operation's end. The reducer
// below accumulates those deltas into a single text part on the in-flight
// assistant message. Image deliverables come back inline as markdown inside the
// assistant text (the renderer turns `![alt](url)` into an <img>), so the
// reducer only needs to handle text — no separate file part for assistant
// images.
const appendAssistantText = (messages: Array<ChatMessage>, delta: string): Array<ChatMessage> => {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") {
    return messages;
  }
  const parts = [...last.parts];
  const tail = parts.at(-1);
  if (tail?.type === "text") {
    parts[parts.length - 1] = { text: tail.text + delta, type: "text" };
  } else {
    parts.push({ text: delta, type: "text" });
  }
  const updated = [...messages];
  updated[updated.length - 1] = { ...last, parts };
  return updated;
};

const toPromptImages = (files: Array<FileUIPart>): Array<AgentPromptImage> => {
  const images: Array<AgentPromptImage> = [];
  for (const file of files) {
    // The Worker resolves the asset by its HMAC-signed URL; pass the URL through
    // the SDK's `data` field rather than re-fetching + base64-encoding here.
    if (file.mediaType?.startsWith("image/")) {
      images.push({ data: file.url, mimeType: file.mediaType, type: "image" });
    }
  }
  return images;
};

const useFlueChat = ({
  agent,
  baseUrl,
  companyId,
  onError,
  sessionToken,
}: UseFlueChatOptions): UseFlueChatResult => {
  const [messages, setMessages] = useState<Array<ChatMessage>>([]);
  const [status, setStatus] = useState<FlueChatStatus>("ready");
  // Tracks the active stream so a new send (or unmount) can cancel the previous
  // one instead of leaking a long-poll connection.
  const abortRef = useRef<AbortController | null>(null);

  const client: FlueClient = useMemo(
    () =>
      createFlueClient({
        // `"/"` keeps the relative-baseUrl path (resolves to current origin in
        // the browser) when no cross-origin Worker URL is configured.
        baseUrl: baseUrl || "/",
        // Forward the first-party session cookie on every request.
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
        // Cross-origin prod fallback: the Worker also accepts a bearer token.
        ...(sessionToken ? { token: sessionToken } : {}),
      }),
    [baseUrl, sessionToken],
  );

  const runStream = useCallback(
    async (offset: string, submissionId: string) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const stream = client.agents.stream(agent, companyId, {
        offset,
        signal: controller.signal,
      });

      let assistantStarted = false;
      try {
        for await (const event of stream as AsyncIterable<AttachedAgentEvent>) {
          // Ignore events that belong to a different submission (the agent
          // instance is shared; the stream may replay neighbouring work).
          if (event.submissionId && event.submissionId !== submissionId) {
            continue;
          }
          switch (event.type) {
            case "message_start": {
              if (event.message.role === "assistant") {
                assistantStarted = true;
                setStatus("streaming");
                setMessages((current) => [
                  ...current,
                  { id: nextMessageId("a"), parts: [], role: "assistant" },
                ]);
              }
              break;
            }
            case "text_delta": {
              if (assistantStarted && event.text) {
                setMessages((current) => appendAssistantText(current, event.text));
              }
              break;
            }
            case "operation": {
              // The top-level `prompt` operation settling marks the whole
              // submission complete (a single submission may run several agent
              // turns, so `agent_end` alone is not terminal).
              if (event.operationKind === "prompt") {
                setStatus("ready");
                controller.abort();
                return;
              }
              break;
            }
            case "submission_settled": {
              if (event.outcome === "failed") {
                throw new Error(event.error ?? "submission failed");
              }
              setStatus("ready");
              controller.abort();
              return;
            }
            default: {
              break;
            }
          }
        }
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setStatus("error");
        onError?.(error);
      }
    },
    [agent, client, companyId, onError],
  );

  const submit = useCallback(
    async (message: string, images: Array<AgentPromptImage>) => {
      setStatus("submitted");
      try {
        const result = await client.agents.send(agent, companyId, { images, message });
        await runStream(result.offset, result.submissionId);
      } catch (error) {
        setStatus("error");
        onError?.(error);
      }
    },
    [agent, client, companyId, onError, runStream],
  );

  const sendMessage = useCallback(
    async (input: SendInput) => {
      const text = input.text.trim();
      if (!text && input.files.length === 0) {
        return;
      }

      const parts: Array<ChatMessagePart> = [];
      if (text) {
        parts.push({ text, type: "text" });
      }
      for (const file of input.files) {
        if (file.mediaType?.startsWith("image/")) {
          parts.push({
            filename: file.filename,
            mediaType: file.mediaType,
            type: "file",
            url: file.url,
          });
        }
      }

      setMessages((current) => [...current, { id: nextMessageId("u"), parts, role: "user" }]);
      await submit(text, toPromptImages(input.files));
    },
    [submit],
  );

  const kickoff = useCallback((prompt: string) => submit(prompt, []), [submit]);

  return { kickoff, messages, sendMessage, status };
};

export { useFlueChat };
export type { ChatMessage, ChatMessagePart, FlueChatStatus, SendInput, UseFlueChatResult };
