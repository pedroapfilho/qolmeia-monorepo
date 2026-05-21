import { cn } from "@repo/ui/lib/utils";

import { API_URL } from "@/lib/api-client";
import type { WebChatMessage } from "@/lib/api-types";

type MessageBubbleProps = {
  message: WebChatMessage;
};

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const extractAssetId = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = (metadata as Record<string, unknown>).assetId;
  return typeof value === "string" ? value : null;
};

// One chat bubble. CUSTOMER messages render right-aligned with a darker
// background; AGENT messages left-aligned with the chip palette. SYSTEM
// messages are centred and muted (rare; reserved for connector-level
// notices like "Designer está trabalhando...").
const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isCustomer = message.sender === "CUSTOMER";
  const isSystem = message.sender === "SYSTEM";
  const assetId = message.contentType === "IMAGE" ? extractAssetId(message.metadata) : null;

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", isCustomer ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2 text-sm",
          isCustomer
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
        {message.contentType === "IMAGE" && assetId ? (
          // Inline brand-asset render. The API streams bytes from R2 via
          // /api/v1/web-chat/assets/:id with a private Cache-Control —
          // safe to render as a plain <img>. next/image needs a configured
          // remote pattern + size hints we don't have here.
          // oxlint-disable-next-line no-img-element
          <img
            alt={message.content || "Imagem gerada"}
            className="max-h-80 rounded-md object-contain"
            src={`${API_URL}/api/v1/web-chat/assets/${assetId}`}
          />
        ) : (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
      </div>
      <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>
        {formatTime(message.createdAt)}
      </time>
    </div>
  );
};

export { MessageBubble };
