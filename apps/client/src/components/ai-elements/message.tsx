"use client";

import { cn } from "@repo/ui/lib/utils";
import type { UIMessage } from "ai";
import type {
  AnchorHTMLAttributes,
  ComponentProps,
  HTMLAttributes,
  ImgHTMLAttributes,
} from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

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

type ImgOverrideProps = ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

const PlainImage = ({ alt, className, src }: ImgOverrideProps) => (
  // oxlint-disable-next-line next/no-img-element
  <img alt={alt ?? ""} className={cn("max-h-80 rounded-md object-contain", className)} src={src} />
);

type AnchorOverrideProps = AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown };

const PlainLink = ({ children, className, href }: AnchorOverrideProps) => (
  <a
    className={cn(
      "font-medium text-primary underline underline-offset-2 hover:text-primary/80",
      className,
    )}
    href={href}
    rel="noopener noreferrer"
    target="_blank"
  >
    {children}
  </a>
);

type StreamdownComponents = NonNullable<ComponentProps<typeof Streamdown>["components"]>;
const STREAMDOWN_COMPONENTS = { a: PlainLink, img: PlainImage } as unknown as StreamdownComponents;

type MessageResponseProps = ComponentProps<typeof Streamdown>;

const MessageResponse = memo(
  ({ className, components, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      components={{ ...STREAMDOWN_COMPONENTS, ...components }}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

MessageResponse.displayName = "MessageResponse";

export { Message, MessageContent, MessageResponse };
export type { MessageContentProps, MessageProps };
