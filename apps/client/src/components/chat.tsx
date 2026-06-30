"use client";

import { Marker, MarkerContent, MarkerIcon } from "@repo/ui/components/marker";
import { Message, MessageAvatar, MessageContent } from "@repo/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/components/message-scroller";
import { Spinner } from "@repo/ui/components/spinner";
import { StatusPill } from "@repo/ui/components/status-pill";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import type { FileUIPart } from "ai";
import { Maximize2, MessageSquare, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { ChatComposer } from "@/components/chat-composer";
import { MessageResponse } from "@/components/markdown-response";
import type { ChatMessage } from "@/lib/use-flue-chat";
import { useFlueChat } from "@/lib/use-flue-chat";

type ChatProps = {
  agent?: "correspondent" | "planner";
  agentsUrl: string;
  companyId: string;
  sessionToken: string;
};

const PLANNER_KICKOFF =
  "O cliente acabou de abrir o chat de onboarding. Cumprimente-o de forma calorosa e breve, diga em uma frase que você vai fazer algumas perguntas para entender o negócio dele, e já faça a primeira pergunta da entrevista.";

const MessageBubble = ({ message }: { message: ChatMessage }) => {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "w-fit max-w-full min-w-0 rounded-2xl px-4 py-2 text-sm",
        isUser
          ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
          : "rounded-bl-sm border border-border bg-card text-foreground",
      )}
    >
      {message.parts.map((part, index) => {
        const partKey = `${message.id}-${index}`;
        if (part.type === "text") {
          return <MessageResponse key={partKey}>{part.text}</MessageResponse>;
        }
        if (part.type === "file" && part.mediaType?.startsWith("image/")) {
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
    </div>
  );
};

type ChatEmptyStateProps = {
  description: string;
  icon: ReactNode;
  title: string;
};

const ChatEmptyState = ({ description, icon, title }: ChatEmptyStateProps) => (
  <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
    <div className="text-muted-foreground">{icon}</div>
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  </div>
);

const ChatInner = ({
  agent: agentName = "correspondent",
  agentsUrl,
  companyId,
  sessionToken,
}: ChatProps) => {
  const { kickoff, messages, sendMessage, status } = useFlueChat({
    agent: agentName,
    baseUrl: agentsUrl,
    companyId,
    onError: () => {
      toast.error("Não foi possível enviar. Tente novamente.");
    },
    sessionToken,
  });

  const kickedOff = useRef(false);
  useEffect(() => {
    if (agentName === "planner" && !kickedOff.current) {
      kickedOff.current = true;
      void kickoff(PLANNER_KICKOFF);
    }
  }, [agentName, kickoff]);

  const isThinking = status === "submitted" || status === "streaming";
  const isCorrespondent = agentName === "correspondent";
  const lastIndex = messages.length - 1;

  const handleSend = useCallback(
    (message: { files: Array<FileUIPart>; text: string }) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

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
          </div>
        </header>
      ) : null}

      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label="Mensagens da conversa">
            <MessageScrollerContent className="p-4">
              {messages.length === 0 ? (
                <ChatEmptyState
                  description="Os agentes da Qolmeia respondem em segundos."
                  icon={<MessageSquare aria-hidden className="size-10" />}
                  title="Comece a conversa"
                />
              ) : (
                <>
                  <Marker variant="separator">
                    <MarkerContent>Início da conversa</MarkerContent>
                  </Marker>
                  {messages.map((message, index) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={index === lastIndex}
                    >
                      <Message align={message.role === "user" ? "end" : "start"}>
                        {message.role === "user" ? null : (
                          <MessageAvatar className="size-7 self-end rounded-lg bg-avatar-1 text-[11px] font-bold text-white">
                            C
                          </MessageAvatar>
                        )}
                        <MessageContent>
                          <MessageBubble message={message} />
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}
                </>
              )}

              {isThinking ? (
                <Marker className="pl-9">
                  <Spinner className="size-4" />
                  <MarkerContent>Um agente está respondendo…</MarkerContent>
                </Marker>
              ) : null}

              {status === "error" ? (
                <Marker className="pl-9 text-destructive">
                  <MarkerIcon>
                    <TriangleAlert aria-hidden />
                  </MarkerIcon>
                  <MarkerContent>Não foi possível enviar. Tente novamente.</MarkerContent>
                </Marker>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <ChatComposer disabled={isThinking} onSend={handleSend} status={status} />
    </div>
  );
};

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
          <Spinner className="size-5 text-muted-foreground" />
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
