import { PageContainer } from "@repo/ui/components/page-container";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AssetsGallery } from "@/components/assets-gallery";
import { apiGetServer } from "@/lib/api-server";
import type { ListResponse, WebChatAsset } from "@/lib/api-types";
import { log } from "@/lib/observability";

export const metadata: Metadata = {
  title: "Assets",
};

const loadAssets = async (): Promise<ReadonlyArray<WebChatAsset>> => {
  try {
    const result = await apiGetServer<ListResponse<WebChatAsset>>("/api/me/assets?limit=200");
    return result.items;
  } catch (error) {
    log.error({ error, message: "assets: failed to load" });
    return [];
  }
};

const AssetsContent = async () => {
  const assets = await loadAssets();

  return (
    <PageContainer>
      <PageHeader
        description="A biblioteca da sua empresa — tudo que o Time criou e usa: imagens, documentos, planos e arquivos enviados."
        title="Assets"
      />
      <AssetsGallery assets={assets} />
    </PageContainer>
  );
};

// Static shell for the prerender: the gallery is bound to the per-request
// session cookie, so cacheComponents needs a Suspense boundary above it.
const AssetsSkeleton = () => (
  <PageContainer aria-hidden>
    <PageHeader
      description="A biblioteca da sua empresa — tudo que o Time criou e usa: imagens, documentos, planos e arquivos enviados."
      title="Assets"
    />
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  </PageContainer>
);

const AssetsPage = () => (
  <Suspense fallback={<AssetsSkeleton />}>
    <AssetsContent />
  </Suspense>
);

export default AssetsPage;
