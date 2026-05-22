"use client";

import { cn } from "@repo/ui/lib/utils";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

// Vendored from `ai-elements`. The branch / toolbar / attachment subcomponents
// from the upstream file are intentionally omitted — they depend on Radix
// ButtonGroup/Tooltip which clash with this repo's `@base-ui` setup, and the
// web-chat UI doesn't need branching or message-level actions.

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

type MessageContentProps = HTMLAttributes<HTMLDivElement>;

const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-sm group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2 group-[.is-user]:text-primary-foreground",
      "group-[.is-assistant]:rounded-2xl group-[.is-assistant]:rounded-bl-sm group-[.is-assistant]:bg-muted group-[.is-assistant]:px-4 group-[.is-assistant]:py-2 group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

type MessageResponseProps = ComponentProps<typeof Streamdown>;

// Markdown renderer — a real upgrade over the previous plain-text bubble.
// Memoised on `children` so a re-render of the message list doesn't re-parse
// every markdown body.
const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

MessageResponse.displayName = "MessageResponse";

export { Message, MessageContent, MessageResponse };
export type { MessageContentProps, MessageProps, MessageResponseProps };
