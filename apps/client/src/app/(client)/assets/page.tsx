import { Card, CardContent } from "@repo/ui/components/card";
import type { Metadata } from "next";

import { API_URL } from "@/lib/api-client";
import { apiGetServer } from "@/lib/api-server";
import type { ListResponse, WebChatAsset } from "@/lib/api-types";

export const metadata: Metadata = {
  title: "Assets",
};

const loadAssets = async (): Promise<ReadonlyArray<WebChatAsset>> => {
  try {
    const result = await apiGetServer<ListResponse<WebChatAsset>>("/web-chat/assets?limit=100");
    return result.items;
  } catch (error) {
    console.error("[assets] failed to load", { error });
    return [];
  }
};

const AssetsPage = async () => {
  const assets = await loadAssets();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Assets de marca</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo que os agentes da Qolmeia já criaram ou anotaram para o seu negócio.
        </p>
      </header>

      {assets.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum asset ainda. Os assets aparecem aqui depois que o Designer cria algo.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <Card key={asset.id}>
              <CardContent className="p-3">
                {asset.mimeType.startsWith("image/") ? (
                  // oxlint-disable-next-line no-img-element
                  <img
                    alt="Asset de marca"
                    className="aspect-square w-full rounded-md object-cover"
                    src={`${API_URL}/api/v1/web-chat/assets/${asset.id}`}
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                    {asset.mimeType}
                  </div>
                )}
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {new Date(asset.createdAt).toLocaleDateString("pt-BR")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AssetsPage;
