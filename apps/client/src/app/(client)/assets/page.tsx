import { PageContainer } from "@repo/ui/components/page-container";
import { PageHeader } from "@repo/ui/components/page-header";
import type { Metadata } from "next";

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

const AssetsPage = async () => {
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

export default AssetsPage;
