import type { AssetSummary, ExistingAssetSummary } from "../dispatcher";

const renderAssetsBlock = (assets: ReadonlyArray<AssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map(
      (a) =>
        `- assetId: ${a.assetId}, mimeType: ${a.mimeType}${a.deduped ? " (já estava no perfil — NÃO labelar)" : ""}`,
    )
    .join("\n");
};

const renderExistingBlock = (assets: ReadonlyArray<ExistingAssetSummary>): string => {
  if (assets.length === 0) {
    return "(nenhum)";
  }
  return assets
    .map(
      (a) =>
        `- assetId: ${a.assetId}, mimeType: ${a.mimeType}, metadata: ${JSON.stringify(a.metadata)}`,
    )
    .join("\n");
};

const renderSystemPrompt = (
  template: string,
  args: {
    currentContext: string;
    existingAssets: ReadonlyArray<ExistingAssetSummary>;
    newAssets: ReadonlyArray<AssetSummary>;
    oversizeCount: number;
  },
): string =>
  template
    .replace(
      "{{currentContext}}",
      args.currentContext.length > 0 ? args.currentContext : "(perfil vazio)",
    )
    .replace("{{existingAssetsBlock}}", renderExistingBlock(args.existingAssets))
    .replace("{{newAssetsBlock}}", renderAssetsBlock(args.newAssets))
    .replace("{{oversizeCount}}", String(args.oversizeCount));

export { renderAssetsBlock, renderExistingBlock, renderSystemPrompt };
