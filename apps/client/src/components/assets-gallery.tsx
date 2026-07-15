"use client";

import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { EmptyState } from "@repo/ui/components/empty-state";
import { toast } from "@repo/ui/lib/toast";
import { cn } from "@repo/ui/lib/utils";
import { Eye, FileText, FolderOpen, Loader2, Music, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useReducer, useState } from "react";

import { AssetPreviewDialog } from "@/components/asset-preview-dialog";
import type { WebChatAsset } from "@/lib/api-types";
import { deleteAssets } from "@/lib/assets";

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

type GalleryState = {
  active: string;
  confirmIds: ReadonlyArray<string> | null;
  deleting: boolean;
  removedIds: ReadonlySet<string>;
  selected: ReadonlySet<string>;
};

const INITIAL_STATE: GalleryState = {
  active: "all",
  confirmIds: null,
  deleting: false,
  removedIds: new Set(),
  selected: new Set(),
};

type GalleryAction =
  | { key: string; type: "setFilter" }
  | { id: string; type: "toggleSelect" }
  | { ids: ReadonlyArray<string>; selectAll: boolean; type: "toggleSelectAll" }
  | { ids: ReadonlyArray<string>; type: "requestDelete" }
  | { type: "cancelDelete" }
  | { type: "deleteStart" }
  | { ids: ReadonlyArray<string>; type: "deleteSuccess" }
  | { type: "deleteError" };

const galleryReducer = (state: GalleryState, action: GalleryAction): GalleryState => {
  switch (action.type) {
    case "setFilter": {
      return { ...state, active: action.key };
    }
    case "toggleSelect": {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) {
        selected.delete(action.id);
      } else {
        selected.add(action.id);
      }
      return { ...state, selected };
    }
    case "toggleSelectAll": {
      const selected = new Set(state.selected);
      for (const id of action.ids) {
        if (action.selectAll) {
          selected.add(id);
        } else {
          selected.delete(id);
        }
      }
      return { ...state, selected };
    }
    case "requestDelete": {
      return { ...state, confirmIds: action.ids };
    }
    case "cancelDelete": {
      return { ...state, confirmIds: null };
    }
    case "deleteStart": {
      return { ...state, deleting: true };
    }
    case "deleteSuccess": {
      const removedIds = new Set(state.removedIds);
      const selected = new Set(state.selected);
      for (const id of action.ids) {
        removedIds.add(id);
        selected.delete(id);
      }
      return { ...state, confirmIds: null, deleting: false, removedIds, selected };
    }
    case "deleteError": {
      return { ...state, deleting: false };
    }
    default: {
      return state;
    }
  }
};

const AssetPreview = ({ asset }: { asset: WebChatAsset }) => {
  if (isImage(asset.mimeType)) {
    return (
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
  const router = useRouter();
  const [state, dispatch] = useReducer(galleryReducer, INITIAL_STATE);
  const { active, confirmIds, deleting, removedIds, selected } = state;
  const [previewing, setPreviewing] = useState<WebChatAsset | null>(null);

  const displayed = assets.filter((asset) => !removedIds.has(asset.id));

  const present = new Set(displayed.map((a) => a.kind));
  const kinds = [...present].toSorted((a, b) => kindLabel(a).localeCompare(kindLabel(b), "pt-BR"));

  const filtered = active === "all" ? displayed : displayed.filter((a) => a.kind === active);

  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  const confirmDelete = async () => {
    if (!confirmIds) {
      return;
    }
    dispatch({ type: "deleteStart" });
    try {
      await deleteAssets(confirmIds);
      dispatch({ ids: confirmIds, type: "deleteSuccess" });
      toast.success(confirmIds.length > 1 ? "Arquivos excluídos." : "Arquivo excluído.");
      router.refresh();
    } catch {
      toast.error("Não foi possível excluir. Tente novamente.");
      dispatch({ type: "deleteError" });
    }
  };

  if (displayed.length === 0) {
    return (
      <Card>
        <EmptyState
          description="Tudo que seu Time criar (imagens, textos, planos, áudios) fica guardado aqui."
          icon={<FolderOpen aria-hidden />}
          title="Nenhum arquivo ainda"
        />
      </Card>
    );
  }

  const confirmCount = confirmIds?.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "Tudo" },
            ...kinds.map((k) => ({ key: k, label: kindLabel(k) })),
          ].map((chip) => {
            const isActive = active === chip.key;
            return (
              <button
                aria-pressed={isActive}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground",
                )}
                key={chip.key}
                onClick={() => dispatch({ key: chip.key, type: "setFilter" })}
                type="button"
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex min-h-8 items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <input
            aria-label="Selecionar todos os arquivos"
            checked={allSelected}
            className="size-4 accent-primary"
            onChange={() =>
              dispatch({
                ids: filtered.map((a) => a.id),
                selectAll: !allSelected,
                type: "toggleSelectAll",
              })
            }
            type="checkbox"
          />
          {selected.size > 0 ? `${selected.size} selecionado(s)` : "Selecionar todos"}
        </label>
        {selected.size > 0 ? (
          <Button
            className="ml-auto rounded-lg"
            onClick={() => dispatch({ ids: [...selected], type: "requestDelete" })}
            size="sm"
            variant="destructive"
          >
            <Trash2 aria-hidden className="size-4" />
            Excluir
          </Button>
        ) : null}
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {filtered.map((asset) => {
          const isSelected = selected.has(asset.id);
          return (
            <li className="relative" key={asset.id}>
              <Card
                className={cn(
                  "gap-0 overflow-hidden rounded-xl py-0 transition-shadow",
                  isSelected ? "ring-2 ring-primary" : "hover:shadow-sm",
                )}
              >
                <button
                  aria-label={`Pré-visualizar ${asset.name}`}
                  className="block w-full cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setPreviewing(asset)}
                  type="button"
                >
                  <AssetPreview asset={asset} />
                  <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{asset.name}</p>
                      <p className="truncate font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                        {kindLabel(asset.kind)} · {formatBytes(asset.size)}
                      </p>
                    </div>
                    <Eye aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                </button>
              </Card>
              <input
                aria-label={`Selecionar ${asset.name}`}
                checked={isSelected}
                className="absolute top-2 left-2 size-4 cursor-pointer accent-primary"
                onChange={() => dispatch({ id: asset.id, type: "toggleSelect" })}
                type="checkbox"
              />
              <button
                aria-label={`Excluir ${asset.name}`}
                className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-destructive"
                onClick={() => dispatch({ ids: [asset.id], type: "requestDelete" })}
                type="button"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            dispatch({ type: "cancelDelete" });
          }
        }}
        open={confirmIds !== null}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Excluir {confirmCount} {confirmCount > 1 ? "arquivos" : "arquivo"}?
            </DialogTitle>
            <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={deleting}
              onClick={() => dispatch({ type: "cancelDelete" })}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={deleting} onClick={confirmDelete} type="button" variant="destructive">
              {deleting ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Trash2 aria-hidden className="size-4" />
              )}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssetPreviewDialog asset={previewing} onClose={() => setPreviewing(null)} />
    </div>
  );
};

export { AssetsGallery };
