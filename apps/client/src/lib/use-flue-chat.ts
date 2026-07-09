"use client";

import { useFlueAgent } from "@flue/react";
import { type AgentPromptImage, createFlueClient, type FlueConversationMessage } from "@flue/sdk";
import type { FileUIPart } from "ai";
import { useEffect, useMemo, useRef } from "react";

type ChatMessage = FlueConversationMessage;

type FlueChatStatus = "error" | "ready" | "streaming" | "submitted";

type SendInput = {
  files: Array<FileUIPart>;
  text: string;
};

type UseFlueChatOptions = {
  agent: "correspondent" | "planner";
  baseUrl: string;
  companyId: string;
  onError?: (error: unknown) => void;
  sessionToken?: string;
};

type UseFlueChatResult = {
  historyReady: boolean;
  kickoff: (prompt: string) => Promise<void>;
  messages: Array<ChatMessage>;
  sendMessage: (input: SendInput) => Promise<void>;
  status: FlueChatStatus;
};

const STATUS_MAP = {
  connecting: "ready",
  error: "error",
  idle: "ready",
  streaming: "streaming",
  submitted: "submitted",
} as const satisfies Record<string, FlueChatStatus>;

const BASE64_CHUNK = 0x80_00;

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
};

// AgentPromptImage.data must be base64 content — the composer hands us hosted
// asset URLs, so the bytes are fetched back before submission.
const toPromptImage = async (url: string, mimeType: string): Promise<AgentPromptImage> => {
  if (url.startsWith("data:")) {
    return { data: url.slice(url.indexOf(",") + 1), mimeType, type: "image" };
  }
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`failed to read attachment (${response.status})`);
  }
  return { data: toBase64(await response.arrayBuffer()), mimeType, type: "image" };
};

const toPromptImages = async (files: Array<FileUIPart>): Promise<Array<AgentPromptImage>> => {
  const imageFiles = files.flatMap((file) =>
    file.mediaType?.startsWith("image/") ? [{ mimeType: file.mediaType, url: file.url }] : [],
  );
  const settled = await Promise.allSettled(
    imageFiles.map((file) => toPromptImage(file.url, file.mimeType)),
  );
  const images: Array<AgentPromptImage> = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
    }
    images.push(result.value);
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
  const client = useMemo(
    () =>
      createFlueClient({
        baseUrl: baseUrl || "/",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
        ...(sessionToken ? { token: sessionToken } : {}),
      }),
    [baseUrl, sessionToken],
  );

  const conversation = useFlueAgent({ client, id: companyId, live: "sse", name: agent });

  const lastErrorRef = useRef<Error | undefined>(undefined);
  useEffect(() => {
    if (conversation.error && conversation.error !== lastErrorRef.current) {
      lastErrorRef.current = conversation.error;
      onError?.(conversation.error);
    }
  }, [conversation.error, onError]);

  const sendMessage = async (input: SendInput) => {
    const text = input.text.trim();
    if (!text && input.files.length === 0) {
      return;
    }
    try {
      await conversation.sendMessage(text, { images: await toPromptImages(input.files) });
    } catch (error) {
      onError?.(error);
      throw error;
    }
  };

  const kickoff = async (prompt: string) => {
    try {
      await conversation.sendMessage(prompt);
    } catch (error) {
      onError?.(error);
      throw error;
    }
  };

  return {
    historyReady: conversation.historyReady,
    kickoff,
    messages: conversation.messages,
    sendMessage,
    status: STATUS_MAP[conversation.status],
  };
};

export { useFlueChat };
export type { ChatMessage, FlueChatStatus, SendInput, UseFlueChatResult };
