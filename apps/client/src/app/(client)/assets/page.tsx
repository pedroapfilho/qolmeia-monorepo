import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { ImageIcon } from "lucide-react";
import type { Metadata } from "next";

import { apiGetServer } from "@/lib/api-server";
import type { ListResponse, WebChatAsset } from "@/lib/api-types";

export const metadata: Metadata = {
  title: "Assets",
};

const loadAssets = async (): Promise<ReadonlyArray<WebChatAsset>> => {
  try {
    const result = await apiGetServer<ListResponse<WebChatAsset>>("/api/me/assets?limit=100");
    return result.items;
  } catch (error) {
    console.error("[assets] failed to load", { error });
    return [];
  }
};

const AssetsPage = async () => {
  const assets = await loadAssets();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        description="Tudo que os agentes da Qolmeia já criaram ou anotaram para o seu negócio."
        title="Assets de marca"
      />

      {assets.length === 0 ? (
        <Card>
          <CardContent className="px-0">
            <EmptyState
              description="Quando o Designer criar algo para você, ele aparece aqui."
              icon={<ImageIcon aria-hidden />}
              title="Nenhum asset ainda"
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id}>
              <Card className="gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
                {asset.mimeType.startsWith("image/") ? (
                  // oxlint-disable-next-line no-img-element
                  <img
                    alt="Asset de marca"
                    className="aspect-square w-full bg-muted object-cover"
                    src={asset.url}
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                    {asset.mimeType}
                  </div>
                )}
                <div className="border-t border-border px-3 py-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(asset.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AssetsPage;
