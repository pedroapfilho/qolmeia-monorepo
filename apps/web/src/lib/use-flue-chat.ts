"use client";

import { useFlueAgent } from "@flue/react";
import {
  createFlueClient,
  type DeliveredAttachment,
  type FlueConversationMessage,
} from "@flue/sdk";
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
  messages: Array<ChatMessage>;
  sendMessage: (input: SendInput) => Promise<void>;
  status: FlueChatStatus;
};

type Conversation = Pick<
  ReturnType<typeof useFlueAgent>,
  "error" | "historyReady" | "messages" | "sendMessage" | "status"
>;

type ConversationHookOptions = {
  sessionToken?: string;
  url: string;
};

type UseConversation = (options: ConversationHookOptions) => Conversation;

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

const toPromptImage = async (url: string, mimeType: string): Promise<DeliveredAttachment> => {
  if (url.startsWith("data:")) {
    return { data: url.slice(url.indexOf(",") + 1), mimeType, type: "image" };
  }
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`failed to read attachment (${response.status})`);
  }
  return { data: toBase64(await response.arrayBuffer()), mimeType, type: "image" };
};

const toPromptImages = async (files: Array<FileUIPart>): Promise<Array<DeliveredAttachment>> => {
  const imageFiles = files.flatMap((file) =>
    file.mediaType?.startsWith("image/") ? [{ mimeType: file.mediaType, url: file.url }] : [],
  );
  const settled = await Promise.allSettled(
    imageFiles.map((file) => toPromptImage(file.url, file.mimeType)),
  );
  const images: Array<DeliveredAttachment> = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
    }
    images.push(result.value);
  }
  return images;
};

const useConversation: UseConversation = ({ sessionToken, url }) => {
  const client = useMemo(
    () =>
      createFlueClient({
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
        url,
        ...(sessionToken !== undefined && sessionToken !== "" ? { token: sessionToken } : {}),
      }),
    [sessionToken, url],
  );

  return useFlueAgent({ client, live: "sse" });
};

const createUseFlueChat = (useAgentConversation: UseConversation) => {
  const useFlueChatWithDependencies = ({
    agent,
    baseUrl,
    companyId,
    onError,
    sessionToken,
  }: UseFlueChatOptions): UseFlueChatResult => {
    const conversation = useAgentConversation({
      sessionToken,
      url: `${(baseUrl || "").replace(/\/+$/v, "")}/agents/${agent}/${companyId}`,
    });

    const lastErrorRef = useRef<Error | undefined>(undefined);
    useEffect(() => {
      if (conversation.error && conversation.error !== lastErrorRef.current) {
        lastErrorRef.current = conversation.error;
        // oxlint-disable-next-line react-doctor/no-pass-data-to-parent -- @flue/react only exposes stream errors as state; this bridges them to the onError callback API
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

    return {
      historyReady: conversation.historyReady,
      messages: conversation.messages,
      sendMessage,
      status: STATUS_MAP[conversation.status],
    };
  };

  return useFlueChatWithDependencies;
};

const useFlueChat = createUseFlueChat(useConversation);

export { createUseFlueChat, useFlueChat };
export type {
  ChatMessage,
  Conversation,
  ConversationHookOptions,
  FlueChatStatus,
  SendInput,
  UseConversation,
  UseFlueChatOptions,
  UseFlueChatResult,
};
