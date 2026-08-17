"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { buttonVariants } from "@repo/ui/lib/button-variants";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";

import { MarkdownResponse } from "@/components/markdown-response";
import type { WebChatAsset } from "@/lib/api-types";

type AssetPreviewDialogProps = {
  asset: WebChatAsset | null;
  onClose: () => void;
};

const isImage = (mime: string): boolean => mime.startsWith("image/");
const isAudio = (mime: string): boolean => mime.startsWith("audio/");
const isText = (mime: string): boolean => mime.startsWith("text/") || mime === "application/json";

const AssetPreviewDialog = ({ asset, onClose }: AssetPreviewDialogProps) => {
  const wantsText = asset !== null && isText(asset.mimeType);

  const { data, isError, isPending } = useQuery({
    enabled: wantsText,
    queryFn: async (): Promise<string> => {
      if (!asset) {
        throw new Error("no asset");
      }
      const res = await fetch(asset.url);
      if (!res.ok) {
        throw new Error(`asset fetch failed (${res.status})`);
      }
      return res.text();
    },
    queryKey: ["asset-text", asset?.id],
    staleTime: 5 * 60 * 1000,
  });

  const renderText = () => {
    if (isPending) {
      return (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Carregando…
        </div>
      );
    }
    if (isError) {
      return (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Não foi possível abrir este arquivo. Use o botão Baixar.
        </p>
      );
    }
    if (asset?.mimeType === "text/markdown") {
      return (
        <div className="text-sm leading-relaxed text-foreground">
          <MarkdownResponse>{data ?? ""}</MarkdownResponse>
        </div>
      );
    }
    return (
      <pre className="overflow-auto rounded-lg bg-muted p-4 font-mono text-xs whitespace-pre-wrap text-foreground">
        {data}
      </pre>
    );
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={asset !== null}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{asset?.name ?? "Arquivo"}</DialogTitle>
          <DialogDescription className="sr-only">Pré-visualização do arquivo</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] overflow-auto">
          {asset && isImage(asset.mimeType) ? (
            // oxlint-disable-next-line no-img-element
            <img
              alt={asset.name}
              className="mx-auto max-h-[60vh] rounded-lg object-contain"
              src={asset.url}
            />
          ) : null}

          {asset && isAudio(asset.mimeType) ? (
            <audio aria-label={asset.name} className="w-full" controls src={asset.url}>
              <track kind="captions" />
            </audio>
          ) : null}

          {asset && isText(asset.mimeType) ? renderText() : null}

          {asset &&
          !isImage(asset.mimeType) &&
          !isAudio(asset.mimeType) &&
          !isText(asset.mimeType) ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Pré-visualização indisponível para este tipo de arquivo.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {asset ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={asset.url}
              rel="noreferrer"
              target="_blank"
            >
              <Download aria-hidden className="size-4" />
              Baixar
            </a>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { AssetPreviewDialog };
