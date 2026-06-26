"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import type { ChatStatus, FileUIPart } from "ai";
import { Loader2, Paperclip, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";
import { apiSendForm } from "@/lib/api-client";

type Attachment = {
  id: string;
  mediaType: string;
  name: string;
  url: string;
};

type UploadResponse = {
  assetId: string;
  mime: string;
  size: number;
  url: string;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = ["image/gif", "image/jpeg", "image/png", "image/webp"];

type ChatComposerProps = {
  disabled: boolean;
  onSend: (message: { files: Array<FileUIPart>; text: string }) => void;
  status: ChatStatus;
};

const ChatComposer = ({ disabled, onSend, status }: ChatComposerProps) => {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<Attachment>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    if (!ALLOWED_UPLOAD_MIME.includes(file.type)) {
      toast.error("Formato não suportado. Use PNG, JPG, WEBP ou GIF.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Imagem grande demais (máx 10 MB).");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiSendForm<UploadResponse>("/api/me/uploads", form);
      setAttachments((current) => [
        ...current,
        { id: result.assetId, mediaType: result.mime, name: file.name, url: result.url },
      ]);
    } catch {
      toast.error("Falha no upload. Tente de novo.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileSelected = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        void uploadFile(file);
      }
    },
    [uploadFile],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const images = [...event.clipboardData.files].filter((file) =>
        file.type.startsWith("image/"),
      );
      if (images.length === 0) {
        return;
      }
      event.preventDefault();
      for (const file of images) {
        void uploadFile(file);
      }
    },
    [uploadFile],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
  }, []);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (disabled || uploading) {
        return;
      }
      if (!text && attachments.length === 0) {
        return;
      }
      const files: Array<FileUIPart> = attachments.map((a) => ({
        filename: a.name,
        mediaType: a.mediaType,
        type: "file",
        url: a.url,
      }));
      onSend({ files, text: text || " " });
      setInput("");
      setAttachments([]);
    },
    [attachments, disabled, onSend, uploading],
  );

  const canSubmit = !disabled && !uploading && (input.trim().length > 0 || attachments.length > 0);

  return (
    <div className="flex-none border-t border-border bg-card px-6 py-4">
      <input
        accept={ALLOWED_UPLOAD_MIME.join(",")}
        aria-label="Anexar imagem"
        className="sr-only"
        onChange={handleFileSelected}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <PromptInput
        className="rounded-xl border-input bg-background shadow-none"
        onSubmit={handleSubmit}
      >
        <PromptInputBody>
          {attachments.length > 0 ? (
            <ul className="flex flex-wrap gap-2 px-2 pb-2">
              {attachments.map((attachment) => (
                <li
                  className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-1"
                  key={attachment.id}
                >
                  {/* oxlint-disable-next-line no-img-element */}
                  <img alt="" className="size-8 rounded-md object-cover" src={attachment.url} />
                  <span className="max-w-32 truncate text-xs text-muted-foreground">
                    {attachment.name}
                  </span>
                  <button
                    aria-label={`Remover ${attachment.name}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => handleRemoveAttachment(attachment.id)}
                    type="button"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <PromptInputTextarea
            aria-label="Mensagem"
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setInput(event.currentTarget.value)}
            onPaste={handlePaste}
            placeholder="Escreva uma mensagem…"
            value={input}
          />
        </PromptInputBody>
        <PromptInputToolbar>
          <Button
            aria-label="Anexar imagem"
            className="rounded-lg"
            disabled={disabled || uploading}
            onClick={handleAttachClick}
            size="icon"
            type="button"
            variant="ghost"
          >
            {uploading ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Paperclip aria-hidden className="size-4" />
            )}
          </Button>
          <PromptInputSubmit className="rounded-lg" disabled={!canSubmit} status={status} />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
};

export { ChatComposer };
