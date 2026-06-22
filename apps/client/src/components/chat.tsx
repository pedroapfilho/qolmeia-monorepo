"use client";

import { useAgentChat } from "@cloudflare/ai-chat/react";
import { StatusPill } from "@repo/ui/components/status-pill";
import { toast } from "@repo/ui/lib/toast";
import { useAgent } from "agents/react";
import type { FileUIPart } from "ai";
import { Maximize2, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { ChatComposer } from "@/components/chat-composer";
import { ResetConversationButton } from "@/components/reset-conversation-button";

type ChatProps = {
  agent?: "correspondent" | "planner";
  agentsUrl: string;
  companyId: string;
  sessionToken: string;
};

// Client chat surface. `useAgent` opens a WebSocket straight to the company's
// agent DO (named by the real org id). `useAgentChat` wraps it with the AI SDK
// chat interface. History, streaming, and reconnection are handled by the
// agents SDK. The `agent` prop picks which DO class to talk to — default is
// "correspondent"; onboarding sets it to "planner". The composer and the reset
// control own their own state; this shell just wires them to the agent.
const ChatInner = ({
  agent: agentName = "correspondent",
  agentsUrl,
  companyId,
  sessionToken,
}: ChatProps) => {
  const agent = useAgent({
    agent: agentName,
    host: agentsUrl,
    name: companyId,
    // Session token the Worker validates against the auth service (spec §9).
    query: { cf_session: sessionToken },
  });

  const { clearHistory, messages, sendMessage, status } = useAgentChat({
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

  const handleSend = useCallback(
    (message: { files: Array<FileUIPart>; text: string }) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  // "Start over": the SDK's clearHistory() empties its message store + the UI
  // across tabs; the RPC empties the agent's in-context recent-turns buffer so
  // the next turn begins fresh. Long-term memory + D1 audit are kept.
  const handleReset = useCallback(async () => {
    clearHistory();
    try {
      await agent.call("resetConversation");
    } catch {
      toast.error("Não foi possível recomeçar. Tente novamente.");
    }
  }, [agent, clearHistory]);

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
          <div className="ml-auto flex items-center gap-2">
            <StatusPill label="Disponível" tone="success" />
            <ResetConversationButton onReset={handleReset} />
          </div>
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
                          const partKey = `${message.id}-${index}`;
                          // Customer's own attachment — plain inline preview.
                          // Asset URL is HMAC-signed by the Worker, so a plain
                          // <img> is correct (no CORS needed for image loads).
                          if (isUser) {
                            return (
                              // oxlint-disable-next-line no-img-element
                              <img
                                alt={part.filename ?? "Imagem"}
                                className="max-h-80 rounded-lg object-contain"
                                key={partKey}
                                src={part.url}
                              />
                            );
                          }
                          // Agent message carrying an image = a team deliverable.
                          // Mark it as such and make it openable at full size so
                          // the customer can recognise and download what their
                          // team produced.
                          return (
                            <figure className="flex flex-col gap-1.5" key={partKey}>
                              <a
                                className="block overflow-hidden rounded-lg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                href={part.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {/* oxlint-disable-next-line no-img-element */}
                                <img
                                  alt={part.filename ?? "Entrega do time"}
                                  className="max-h-80 w-full object-contain"
                                  src={part.url}
                                />
                              </a>
                              <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Maximize2 aria-hidden className="size-3.5" />
                                Entrega do seu time · abrir em tamanho real
                              </figcaption>
                            </figure>
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
      <ChatComposer disabled={isThinking} onSend={handleSend} status={status} />
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
