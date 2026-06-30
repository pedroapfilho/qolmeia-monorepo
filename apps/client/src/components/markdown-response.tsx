"use client";

import { cn } from "@repo/ui/lib/utils";
import type { AnchorHTMLAttributes, ComponentProps, ImgHTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

type ImgOverrideProps = ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

const PlainImage = ({ alt, className, src }: ImgOverrideProps) => (
  // oxlint-disable-next-line no-img-element
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

export { MessageResponse };
export type { MessageResponseProps };
