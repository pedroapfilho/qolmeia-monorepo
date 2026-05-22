"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { Send } from "lucide-react";
import { useState } from "react";

import { apiSend } from "@/lib/api-client";
import type { PostMessageResponse } from "@/lib/api-types";

type ComposerProps = {
  conversationId: string | null;
  onSent: (response: PostMessageResponse, sentText: string, sentAt: string) => void;
};

// Single-line auto-grow textarea + send button. Enter submits;
// Shift+Enter inserts a newline. Disabled while the request is in flight
// so double-submits aren't possible.
const Composer = ({ conversationId, onSent }: ComposerProps) => {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || pending) {
      return;
    }
    setPending(true);
    const sentAt = new Date().toISOString();
    try {
      const response = await apiSend<PostMessageResponse>("POST", "/web-chat/messages", {
        ...(conversationId ? { conversationId } : {}),
        text: trimmed,
      });
      onSent(response, trimmed, sentAt);
      setText("");
    } catch (error) {
      console.error("[composer] send failed", { error });
      toast.error("Não foi possível enviar. Tente novamente.");
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-border bg-card p-3"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor="composer-text">
        Mensagem
      </label>
      <textarea
        className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        disabled={pending}
        id="composer-text"
        name="message"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escreva sua mensagem..."
        rows={1}
        value={text}
      />
      <Button
        aria-label="Enviar"
        disabled={pending || text.trim().length === 0}
        size="icon"
        type="submit"
      >
        <Send aria-hidden />
      </Button>
    </form>
  );
};

export { Composer };
