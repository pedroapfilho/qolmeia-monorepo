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

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

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

  return <AssetsGallery assets={assets} />;
};

const AssetsSkeleton = () => (
  <div aria-hidden className="grid grid-cols-2 gap-4 sm:grid-cols-3">
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-40 w-full" />
  </div>
);

const AssetsPage = () => (
  <PageContainer>
    <PageHeader
      description="A biblioteca da sua empresa, com tudo que o Time criou e usa: imagens, documentos, planos e arquivos enviados."
      title="Assets"
    />
    <Suspense fallback={<AssetsSkeleton />}>
      <AssetsContent />
    </Suspense>
  </PageContainer>
);

export default AssetsPage;
