"use client";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Button } from "@repo/ui/components/button";
import { StatusPill } from "@repo/ui/components/status-pill";
import { toast } from "@repo/ui/lib/toast";
import { useAgent } from "agents/react";
import type { FileUIPart } from "ai";
import { Loader2, MessageSquare, Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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
const ChatInner = ({
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

  const isCorrespondent = agentName === "correspondent";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      {isCorrespondent ? (
        <header className="flex h-[54px] flex-none items-center gap-3 border-b border-border bg-card px-6">
          <span
            aria-hidden
            className="flex size-8 flex-none items-center justify-center rounded-lg bg-avatar-1 text-[13px] font-bold text-white"
          >
            C
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold tracking-tight text-foreground">
              Correspondente
            </div>
            <div className="text-xs text-muted-foreground">Seu ponto de contato</div>
          </div>
          <StatusPill className="ml-auto" label="Disponível" tone="success" />
        </header>
      ) : null}
      <Conversation>
        <ConversationContent className="gap-4">
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="Os agentes da Qolmeia respondem em segundos."
              icon={<MessageSquare aria-hidden className="size-10" />}
              title="Comece a conversa"
            />
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <div className="flex items-start gap-2.5" key={message.id}>
                  {isUser ? null : (
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-avatar-1 text-[11px] font-bold text-white"
                    >
                      C
                    </span>
                  )}
                  <Message from={message.role}>
                    <MessageContent className="group-[.is-assistant]:rounded-xl group-[.is-assistant]:rounded-tl-sm group-[.is-assistant]:rounded-bl-xl group-[.is-assistant]:border group-[.is-assistant]:border-border group-[.is-assistant]:bg-card group-[.is-assistant]:px-3.5 group-[.is-assistant]:py-2.5 group-[.is-assistant]:text-foreground group-[.is-user]:rounded-xl group-[.is-user]:rounded-tr-sm group-[.is-user]:rounded-br-xl group-[.is-user]:px-3.5 group-[.is-user]:py-2.5">
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
                              className="max-h-80 rounded-lg object-contain"
                              key={`${message.id}-${index}`}
                              src={part.url}
                            />
                          );
                        }
                        return null;
                      })}
                    </MessageContent>
                  </Message>
                </div>
              );
            })
          )}
          {isThinking ? (
            <div className="flex items-center gap-2.5 pl-[38px]">
              <Loader className="text-muted-foreground" size={16} />
              <span className="text-sm text-muted-foreground">Um agente está respondendo…</span>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="flex-none border-t border-border bg-card px-6 py-4">
        <input
          accept={ALLOWED_UPLOAD_MIME.join(",")}
          aria-label="Anexar imagem"
          className="sr-only"
          onChange={handleFileSelected}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
        <PromptInput
          className="rounded-xl border-input bg-background shadow-none"
          onSubmit={handleSubmit}
        >
          <PromptInputBody>
            {attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2 px-2 pb-2">
                {attachments.map((attachment) => (
                  <li
                    className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-1"
                    key={attachment.id}
                  >
                    {/* oxlint-disable-next-line no-img-element */}
                    <img alt="" className="size-8 rounded-md object-cover" src={attachment.url} />
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
              placeholder="Escreva uma mensagem…"
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <Button
              aria-label="Anexar imagem"
              className="mr-auto rounded-lg"
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
            <PromptInputSubmit className="rounded-lg" disabled={!canSubmit} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
};

// `useAgent`/`useAgentChat` are browser-only: on the server `partysocket` has no
// `window.location.host`, falls back to a placeholder host, and its initial
// fetch throws `ENOTFOUND dummy-domain.com`. Gate the real chat behind a
// client-only flag so the SDK hooks never run during SSR. `useSyncExternalStore`
// returns the server snapshot (false) during SSR and the client snapshot (true)
// after hydration without a setState-in-effect. The skeleton mirrors the final
// layout to avoid layout shift on hydration.
const subscribeNoop = () => () => {};
const Chat = (props: ChatProps) => {
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  if (!isClient) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
        <div className="flex flex-1 items-center justify-center">
          <Loader className="text-muted-foreground" size={20} />
        </div>
        <div className="flex-none border-t border-border bg-card px-6 py-4">
          <div className="h-16 rounded-xl border border-input bg-background" />
        </div>
      </div>
    );
  }

  return <ChatInner {...props} />;
};

export { Chat };
