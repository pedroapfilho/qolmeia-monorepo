"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
import { toast } from "@repo/ui/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

import {
  BRAND_CATEGORIES,
  BRAND_CATEGORY_LABEL,
  type BrandAsset,
  type BrandCategory,
  deleteBrandAsset,
  fetchBrandAssets,
  uploadBrandAsset,
} from "@/lib/company";

const isBrandCategory = (value: string): value is BrandCategory =>
  BRAND_CATEGORIES.some((category) => category.value === value);

const brandQueryKey = (companyId: string) => ["brand-assets", companyId] as const;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp"];

type BrandAssetsProps = {
  companyId: string;
  initialData?: Array<BrandAsset>;
};

type UploadContext = {
  optimisticId: string;
  previous: Array<BrandAsset> | undefined;
};

type DeleteContext = {
  previous: Array<BrandAsset> | undefined;
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Falha ao preparar a imagem."));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Falha ao preparar a imagem."));
    });
    reader.readAsDataURL(file);
  });

const BrandAssets = ({ companyId, initialData }: BrandAssetsProps) => {
  const queryClient = useQueryClient();
  const queryKey = brandQueryKey(companyId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<BrandCategory>("logo");

  const { data: assets = [], isPending } = useQuery({
    initialData,
    meta: { errorToast: "Falha ao carregar a marca" },
    queryFn: fetchBrandAssets,
    queryKey,
  });

  const uploadMutation = useMutation<BrandAsset, Error, File, UploadContext>({
    mutationFn: (file: File) => uploadBrandAsset(file, category),
    onError: (_error, _file, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error("Falha no upload. Tente de novo.");
    },
    onMutate: async (file) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Array<BrandAsset>>(queryKey);
      const previewUrl = await fileToDataUrl(file);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimisticAsset: BrandAsset = {
        category,
        createdAt: new Date().toISOString(),
        id: optimisticId,
        mimeType: file.type,
        name: file.name || null,
        url: previewUrl,
      };
      queryClient.setQueryData<Array<BrandAsset>>(queryKey, (current = []) => [
        optimisticAsset,
        ...current,
      ]);
      return { optimisticId, previous };
    },
    onSuccess: (asset, _file, context) => {
      queryClient.setQueryData<Array<BrandAsset>>(queryKey, (current = []) =>
        current.map((item) => (item.id === context.optimisticId ? asset : item)),
      );
      toast.success("Referência adicionada.");
    },
  });

  const deleteMutation = useMutation<boolean, Error, string, DeleteContext>({
    mutationFn: (id: string) => deleteBrandAsset(id),
    onError: (_error, _id, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error("Não foi possível remover.");
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Array<BrandAsset>>(queryKey);
      queryClient.setQueryData<Array<BrandAsset>>(queryKey, (current = []) =>
        current.filter((asset) => asset.id !== id),
      );
      return { previous };
    },
  });

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error("Formato não suportado. Use PNG, JPG, WEBP, GIF ou SVG.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Imagem grande demais (máx 10 MB).");
      return;
    }
    uploadMutation.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identidade da marca</CardTitle>
        <CardDescription>
          Envie seu logo, posts e referências visuais. O Designer usa essas imagens para manter as
          entregas alinhadas à sua marca.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Categoria
            <select
              className="h-11 rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 sm:h-9 sm:text-sm"
              onChange={(e) => {
                const { value } = e.currentTarget;
                if (isBrandCategory(value)) {
                  setCategory(value);
                }
              }}
              value={category}
            >
              {BRAND_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <input
            accept={ALLOWED_MIME.join(",")}
            aria-label="Enviar arquivo de marca"
            className="sr-only"
            onChange={handleFileSelected}
            ref={fileRef}
            type="file"
          />
          <Button
            disabled={uploadMutation.isPending}
            onClick={() => fileRef.current?.click()}
            type="button"
            variant="outline"
          >
            {uploadMutation.isPending ? (
              <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
            ) : (
              <ImagePlus aria-hidden className="size-4" />
            )}
            Adicionar
          </Button>
        </div>

        {isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="aspect-square w-full" />
          </div>
        ) : null}
        {!isPending && assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma referência ainda. Comece pelo logo.
          </p>
        ) : null}
        {!isPending && assets.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <li
                className="relative overflow-hidden rounded-lg border border-border bg-muted"
                key={asset.id}
              >
                {/* Asset URL is HMAC-signed by the Worker; a plain <img> is correct. */}
                {/* oxlint-disable-next-line no-img-element */}
                <img
                  alt={asset.name ?? "Referência de marca"}
                  className="aspect-square w-full object-cover"
                  src={asset.url}
                />
                <Badge className="absolute top-1.5 left-1.5" variant="muted">
                  {BRAND_CATEGORY_LABEL[asset.category]}
                </Badge>
                <button
                  aria-label="Remover referência"
                  className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    deleteMutation.mutate(asset.id);
                  }}
                  type="button"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
};

export { BrandAssets };
