"use client";

import { Card } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { cn } from "@repo/ui/lib/utils";
import { Download, FileText, FolderOpen, Music } from "lucide-react";
import { useMemo, useState } from "react";

import type { WebChatAsset } from "@/lib/api-types";

const KIND_LABEL: Record<string, string> = {
  audio: "Áudio",
  brand_asset: "Marca",
  generated_image: "Imagens",
  knowledge_doc: "Documentos",
  user_upload: "Uploads",
};

const kindLabel = (kind: string): string => KIND_LABEL[kind] ?? "Outros";

const isImage = (mime: string): boolean => mime.startsWith("image/");
const isAudio = (mime: string): boolean => mime.startsWith("audio/");

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const AssetPreview = ({ asset }: { asset: WebChatAsset }) => {
  if (isImage(asset.mimeType)) {
    return (
      // Signed URL; a plain <img> is correct.
      // oxlint-disable-next-line no-img-element
      <img
        alt={asset.name}
        className="aspect-square w-full bg-muted object-cover"
        src={asset.url}
      />
    );
  }
  const Icon = isAudio(asset.mimeType) ? Music : FileText;
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
      <Icon aria-hidden className="size-9" />
      <span className="font-mono text-[10px] tracking-wide uppercase">{kindLabel(asset.kind)}</span>
    </div>
  );
};

type AssetsGalleryProps = {
  assets: ReadonlyArray<WebChatAsset>;
};

const AssetsGallery = ({ assets }: AssetsGalleryProps) => {
  const [active, setActive] = useState<string>("all");

  const kinds = useMemo(() => {
    const present = new Set(assets.map((a) => a.kind));
    return [...present].toSorted((a, b) => kindLabel(a).localeCompare(kindLabel(b), "pt-BR"));
  }, [assets]);

  const filtered = active === "all" ? assets : assets.filter((a) => a.kind === active);

  if (assets.length === 0) {
    return (
      <Card>
        <EmptyState
          description="Tudo que seu Time criar — imagens, textos, planos, áudios — fica guardado aqui."
          icon={<FolderOpen aria-hidden />}
          title="Nenhum arquivo ainda"
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "Tudo" },
            ...kinds.map((k) => ({ key: k, label: kindLabel(k) })),
          ].map((chip) => {
            const selected = active === chip.key;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground",
                )}
                key={chip.key}
                onClick={() => setActive(chip.key)}
                type="button"
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {filtered.map((asset) => (
          <li key={asset.id}>
            <a
              className="group block focus-visible:outline-none"
              href={asset.url}
              rel="noreferrer"
              target="_blank"
            >
              <Card className="gap-0 overflow-hidden rounded-xl py-0 transition-shadow group-hover:shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-ring">
                <AssetPreview asset={asset} />
                <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{asset.name}</p>
                    <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                      {kindLabel(asset.kind)} · {formatBytes(asset.size)}
                    </p>
                  </div>
                  <Download
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  />
                </div>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export { AssetsGallery };
