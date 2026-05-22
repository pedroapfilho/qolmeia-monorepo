"use client";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import type { ChatStatus } from "ai";
import { CornerDownLeft, Square, X } from "lucide-react";
import type { ComponentProps, FormEvent, KeyboardEvent, TextareaHTMLAttributes } from "react";
import { useCallback, useRef } from "react";

import { Loader } from "@/components/ai-elements/loader";

// Vendored from `ai-elements`, reduced to the textarea + submit surface the
// web-chat UI needs. The upstream component ships an attachment/model toolbar
// built on six Radix-based shadcn components; this repo runs on `@base-ui`, so
// those pieces are dropped rather than pulling in a parallel UI stack. The
// public shape (`onSubmit` receiving a `PromptInputMessage`) is kept so a
// future swap to the published component is mechanical.

type PromptInputMessage = {
  text: string;
};

type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void;
};

const PromptInput = ({ children, className, onSubmit, ...props }: PromptInputProps) => {
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const text = (formData.get("message") ?? "").toString();
      onSubmit({ text }, event);
    },
    [onSubmit],
  );

  return (
    <form
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm",
        className,
      )}
      onSubmit={handleSubmit}
      {...props}
    >
      {children}
    </form>
  );
};

type PromptInputBodyProps = ComponentProps<"div">;

const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("flex flex-col", className)} {...props} />
);

type PromptInputTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// Auto-grows up to a cap. Enter submits; Shift+Enter inserts a newline.
const PromptInputTextarea = ({
  className,
  onInput,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event);
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [onKeyDown],
  );

  return (
    <textarea
      className={cn(
        "max-h-40 min-h-11 w-full resize-none bg-transparent px-2 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none sm:text-sm",
        className,
      )}
      name="message"
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
      onKeyDown={handleKeyDown}
      ref={ref}
      rows={1}
      {...props}
    />
  );
};

type PromptInputToolbarProps = ComponentProps<"div">;

const PromptInputToolbar = ({ className, ...props }: PromptInputToolbarProps) => (
  <div className={cn("flex items-center justify-end gap-2", className)} {...props} />
);

type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
};

const PromptInputSubmit = ({
  children,
  className,
  size = "icon",
  status,
  variant = "default",
  ...props
}: PromptInputSubmitProps) => {
  let icon = <CornerDownLeft aria-hidden className="size-4" />;
  if (status === "submitted") {
    icon = <Loader size={16} />;
  } else if (status === "streaming") {
    icon = <Square aria-hidden className="size-4" />;
  } else if (status === "error") {
    icon = <X aria-hidden className="size-4" />;
  }

  return (
    <Button
      aria-label="Enviar"
      className={className}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? icon}
    </Button>
  );
};

export { PromptInput, PromptInputBody, PromptInputSubmit, PromptInputTextarea, PromptInputToolbar };
export type {
  PromptInputBodyProps,
  PromptInputMessage,
  PromptInputProps,
  PromptInputSubmitProps,
  PromptInputTextareaProps,
  PromptInputToolbarProps,
};
