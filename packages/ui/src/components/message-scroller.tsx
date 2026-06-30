"use client";

import { MessageScroller as MessageScrollerPrimitive } from "@shadcn/react/message-scroller";
import { ArrowDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

import { Button } from "./button";

const MessageScrollerProvider = (
  props: ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) => <MessageScrollerPrimitive.Provider {...props} />;

const MessageScroller = ({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>) => (
  <MessageScrollerPrimitive.Root
    className={cn(
      "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
      className,
    )}
    data-slot="message-scroller"
    {...props}
  />
);

const MessageScrollerViewport = ({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) => (
  <MessageScrollerPrimitive.Viewport
    className={cn(
      "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent",
      className,
    )}
    data-slot="message-scroller-viewport"
    {...props}
  />
);

const MessageScrollerContent = ({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) => (
  <MessageScrollerPrimitive.Content
    className={cn("flex h-max min-h-full flex-col gap-6", className)}
    data-slot="message-scroller-content"
    {...props}
  />
);

const MessageScrollerItem = ({
  className,
  scrollAnchor = false,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) => (
  <MessageScrollerPrimitive.Item
    className={cn(
      "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
      className,
    )}
    data-slot="message-scroller-item"
    scrollAnchor={scrollAnchor}
    {...props}
  />
);

type MessageScrollerButtonProps = ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<ComponentProps<typeof Button>, "size" | "variant">;

const MessageScrollerButton = ({
  children,
  className,
  direction = "end",
  render,
  size = "icon-sm",
  variant = "secondary",
  ...props
}: MessageScrollerButtonProps) => (
  <MessageScrollerPrimitive.Button
    className={cn(
      "absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
      className,
    )}
    data-direction={direction}
    data-size={size}
    data-slot="message-scroller-button"
    data-variant={variant}
    direction={direction}
    render={render ?? <Button size={size} variant={variant} />}
    {...props}
  >
    {children ?? (
      <>
        <ArrowDown aria-hidden />
        <span className="sr-only">
          {direction === "end" ? "Rolar para o fim" : "Rolar para o início"}
        </span>
      </>
    )}
  </MessageScrollerPrimitive.Button>
);

export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
};
