"use client";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@repo/ui/components/attachment";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import type { ChatStatus, FileUIPart } from "ai";
import { CornerDownLeft, Paperclip, Square, X } from "lucide-react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, SubmitEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { apiSendForm } from "@/lib/api-client";

type UploadState = "uploading" | "error" | "done";

type Attachment = {
  id: string;
  mediaType: string;
  name: string;
  state: UploadState;
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

const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
};

type ChatComposerProps = {
  disabled: boolean;
  onSend: (message: { files: Array<FileUIPart>; text: string }) => void;
  status: ChatStatus;
};

const ChatComposer = ({ disabled, onSend, status }: ChatComposerProps) => {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ReadonlyArray<Attachment>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const objectUrlsRef = useRef<Set<string> | null>(null);

  const isUploading = attachments.some((attachment) => attachment.state === "uploading");
  const readyAttachments = attachments.filter((attachment) => attachment.state === "done");

  const getObjectUrls = () => {
    const existing = objectUrlsRef.current;
    if (existing) {
      return existing;
    }
    const created = new Set<string>();
    objectUrlsRef.current = created;
    return created;
  };

  const revokeObjectUrl = (url: string) => {
    if (getObjectUrls().delete(url)) {
      URL.revokeObjectURL(url);
    }
  };

  useEffect(
    () => () => {
      const urls = objectUrlsRef.current;
      if (urls) {
        for (const url of urls) {
          URL.revokeObjectURL(url);
        }
        urls.clear();
      }
    },
    [],
  );

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    if (!ALLOWED_UPLOAD_MIME.includes(file.type)) {
      toast.error("Formato não suportado. Use PNG, JPG, WEBP ou GIF.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Imagem grande demais (máx 10 MB).");
      return;
    }

    const tempId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    getObjectUrls().add(previewUrl);
    setAttachments((current) => [
      ...current,
      { id: tempId, mediaType: file.type, name: file.name, state: "uploading", url: previewUrl },
    ]);

    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiSendForm<UploadResponse>("/api/me/uploads", form);
      revokeObjectUrl(previewUrl);
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === tempId
            ? {
                id: result.assetId,
                mediaType: result.mime,
                name: file.name,
                state: "done",
                url: result.url,
              }
            : attachment,
        ),
      );
    } catch {
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === tempId ? { ...attachment, state: "error" } : attachment,
        ),
      );
      toast.error("Falha no upload. Tente de novo.");
    }
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void uploadFile(file);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of images) {
      void uploadFile(file);
    }
  };

  const handleRemoveAttachment = (target: Attachment) => {
    revokeObjectUrl(target.url);
    setAttachments((current) => current.filter((attachment) => attachment.id !== target.id));
  };

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (disabled || isUploading) {
      return;
    }
    if (!text && readyAttachments.length === 0) {
      return;
    }
    const files: Array<FileUIPart> = readyAttachments.map((attachment) => ({
      filename: attachment.name,
      mediaType: attachment.mediaType,
      type: "file",
      url: attachment.url,
    }));
    onSend({ files, text: text || " " });
    setInput("");
    const urls = getObjectUrls();
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
    urls.clear();
    setAttachments([]);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  };

  const canSubmit =
    !disabled && !isUploading && (input.trim().length > 0 || readyAttachments.length > 0);

  let submitIcon = <CornerDownLeft aria-hidden className="size-4" />;
  if (status === "submitted") {
    submitIcon = <Spinner className="size-4" />;
  } else if (status === "streaming") {
    submitIcon = <Square aria-hidden className="size-4" />;
  } else if (status === "error") {
    submitIcon = <X aria-hidden className="size-4" />;
  }

  return (
    <div className="flex-none border-t border-border bg-card px-6 py-4">
      <form
        className="flex flex-col gap-2 rounded-xl border border-input bg-background p-2"
        onSubmit={handleSubmit}
      >
        <input
          accept={ALLOWED_UPLOAD_MIME.join(",")}
          aria-label="Anexar imagem"
          className="sr-only"
          onChange={handleFileSelected}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />

        {attachments.length > 0 ? (
          <AttachmentGroup className="px-1">
            {attachments.map((attachment) => (
              <Attachment key={attachment.id} size="sm" state={attachment.state}>
                <AttachmentMedia variant={attachment.state === "uploading" ? "icon" : "image"}>
                  {attachment.state === "uploading" ? (
                    <Spinner />
                  ) : (
                    // oxlint-disable-next-line no-img-element
                    <img alt="" src={attachment.url} />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{attachment.name}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remover ${attachment.name}`}
                    onClick={() => {
                      handleRemoveAttachment(attachment);
                    }}
                    type="button"
                  >
                    <X aria-hidden />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}

        <textarea
          aria-label="Mensagem"
          autoComplete="off"
          className={cn(
            "max-h-40 min-h-11 w-full resize-none rounded-md bg-transparent px-2 py-2 text-base outline-none",
            "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none sm:text-sm",
          )}
          name="message"
          onChange={(event) => {
            setInput(event.currentTarget.value);
          }}
          onInput={resizeTextarea}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Escreva uma mensagem…"
          ref={textareaRef}
          rows={1}
          value={input}
        />

        <div className="flex items-center justify-end gap-2">
          <Button
            aria-label="Anexar imagem"
            disabled={disabled || isUploading}
            onClick={handleAttachClick}
            size="icon"
            type="button"
            variant="ghost"
          >
            {isUploading ? (
              <Spinner className="size-4" />
            ) : (
              <Paperclip aria-hidden className="size-4" />
            )}
          </Button>
          <Button aria-label="Enviar" disabled={!canSubmit} size="icon" type="submit">
            {submitIcon}
          </Button>
        </div>
      </form>
    </div>
  );
};

export { ChatComposer };
