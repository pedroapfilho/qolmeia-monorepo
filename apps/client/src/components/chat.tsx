"use client";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import { useAgent } from "agents/react";
import type { FileUIPart } from "ai";
import { Loader2, MessageSquare, Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";
import { apiSendForm } from "@/lib/api-client";

type ChatProps = {
  agent?: "correspondent" | "planner";
  agentsUrl: string;
  companyId: string;
  sessionToken: string;
};

type Attachment = {
  id: string;
  mediaType: string;
  name: string;
  url: string;
};

type UploadResponse = {
  assetId: string;
  mime: string;
  size: number;
  url: string;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = ["image/gif", "image/jpeg", "image/png", "image/webp"];

// Client chat surface. `useAgent` opens a WebSocket straight to the company's
// agent DO (named by the real org id). `useAgentChat` wraps it with the AI SDK
// chat interface. History, streaming, and reconnection are handled by the
// agents SDK. The `agent` prop picks which DO class to talk to — default is
// "correspondent"; onboarding sets it to "planner".
const Chat = ({
  agent: agentName = "correspondent",
  agentsUrl,
  companyId,
  sessionToken,
}: ChatProps) => {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<Attachment>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = useAgent({
    agent: agentName,
    host: agentsUrl,
    name: companyId,
    // Session token the Worker validates against the auth service (spec §9).
    query: { cf_session: sessionToken },
  });

  const { messages, sendMessage, status } = useAgentChat({
    agent,
    // Surface send/stream failures where they happen instead of watching
    // the `error` state from an effect.
    onError: () => {
      toast.error("Não foi possível enviar. Tente novamente.");
    },
  });

  // When the app has no business info yet, the Planner opens the conversation
  // itself instead of leaving a blank chat. Best-effort: the DO re-checks the
  // transcript + brief and no-ops if an opening isn't warranted, so an
  // optimistic fire here is safe even before history finishes syncing.
  const didKickoff = useRef(false);
  useEffect(() => {
    if (agentName !== "planner" || didKickoff.current || messages.length > 0) {
      return;
    }
    didKickoff.current = true;
    void agent.call("startOpeningTurn");
  }, [agentName, messages.length, agent]);

  const isThinking = status === "submitted" || status === "streaming";

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-selecting the same file fires `change` again.
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!ALLOWED_UPLOAD_MIME.includes(file.type)) {
      toast.error("Formato não suportado. Use PNG, JPG, WEBP ou GIF.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Imagem grande demais (máx 10 MB).");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiSendForm<UploadResponse>("/api/me/uploads", form);
      setAttachments((current) => [
        ...current,
        {
          id: result.assetId,
          mediaType: result.mime,
          name: file.name,
          url: result.url,
        },
      ]);
    } catch {
      toast.error("Falha no upload. Tente de novo.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
  }, []);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (isThinking || uploading) {
        return;
      }
      if (!text && attachments.length === 0) {
        return;
      }
      const files: Array<FileUIPart> = attachments.map((a) => ({
        filename: a.name,
        mediaType: a.mediaType,
        type: "file",
        url: a.url,
      }));
      void sendMessage({ files, text: text || " " });
      setInput("");
      setAttachments([]);
    },
    [attachments, isThinking, sendMessage, uploading],
  );

  const canSubmit =
    !isThinking && !uploading && (input.trim().length > 0 || attachments.length > 0);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="Os agentes da Qolmeia respondem em segundos."
              icon={<MessageSquare aria-hidden className="size-10" />}
              title="Comece a conversa"
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <MessageResponse key={`${message.id}-${index}`}>
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (part.type === "file" && part.mediaType?.startsWith("image/")) {
                      return (
                        // Asset URL is HMAC-signed by the Worker; a plain <img>
                        // is correct — no CORS needed for image loads.
                        // oxlint-disable-next-line no-img-element
                        <img
                          alt={part.filename ?? "Imagem"}
                          className="max-h-80 rounded-md object-contain"
                          key={`${message.id}-${index}`}
                          src={part.url}
                        />
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {isThinking ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader size={16} />
              <span>Um agente está respondendo…</span>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t border-border bg-card p-3">
        <input
          accept={ALLOWED_UPLOAD_MIME.join(",")}
          aria-label="Anexar imagem"
          className="sr-only"
          onChange={handleFileSelected}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            {attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2 px-2 pb-2">
                {attachments.map((attachment) => (
                  <li
                    className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1"
                    key={attachment.id}
                  >
                    {/* oxlint-disable-next-line no-img-element */}
                    <img alt="" className="size-8 rounded object-cover" src={attachment.url} />
                    <span className="max-w-32 truncate text-xs text-muted-foreground">
                      {attachment.name}
                    </span>
                    <button
                      aria-label={`Remover ${attachment.name}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      type="button"
                    >
                      <X aria-hidden className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <PromptInputTextarea
              aria-label="Mensagem"
              autoComplete="off"
              disabled={isThinking}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="Escreva sua mensagem…"
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <Button
              aria-label="Anexar imagem"
              disabled={isThinking || uploading}
              onClick={handleAttachClick}
              size="icon"
              type="button"
              variant="ghost"
            >
              {uploading ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Paperclip aria-hidden className="size-4" />
              )}
            </Button>
            <PromptInputSubmit disabled={!canSubmit} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
};

export { Chat };
