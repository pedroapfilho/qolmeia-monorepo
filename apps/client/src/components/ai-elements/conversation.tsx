"use client";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { ArrowDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

// Vendored from `ai-elements`, re-pointed at `@repo/ui` primitives.

type ConversationProps = ComponentProps<typeof StickToBottom>;

const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn("flex flex-col gap-6 p-4", className)} {...props} />
);

type ConversationEmptyStateProps = ComponentProps<"div"> & {
  description?: string;
  icon?: ReactNode;
  title?: string;
};

const ConversationEmptyState = ({
  children,
  className,
  description,
  icon,
  title = "Sem mensagens ainda",
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? (
            <p className="max-w-md text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </>
    )}
  </div>
);

type ConversationScrollButtonProps = ComponentProps<typeof Button>;

const ConversationScrollButton = ({ className, ...props }: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      aria-label="Rolar para o fim"
      className={cn("absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full", className)}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDown aria-hidden className="size-4" />
    </Button>
  );
};

export { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton };
export type {
  ConversationContentProps,
  ConversationEmptyStateProps,
  ConversationProps,
  ConversationScrollButtonProps,
};
