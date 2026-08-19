import { z } from "zod";

import { getDb } from "#/db/client";
import { listCompanyAssets, persistAsset, readAssetText } from "#/lib/asset-store";
import type { AssetSummary } from "#/lib/asset-store";
import type { SkillContext, SkillInput, UnknownSkill } from "#/skills/registry";

const ASSET_KINDS = [
  "audio",
  "brand_asset",
  "generated_image",
  "knowledge_doc",
  "user_upload",
] as const;

const listAssetsInputSchema = z.object({
  folder: z
    .enum(["agent", "customer"])
    .optional()
    .describe(
      "Filtrar por pasta: 'customer' (entregas/uploads do cliente) ou 'agent' (material de trabalho). Omita para ver as duas.",
    ),
  kind: z.enum(ASSET_KINDS).optional().describe("Filtrar por tipo. Omita para listar tudo."),
});

const listAssetsSkill: UnknownSkill = {
  description:
    "Lista os arquivos da biblioteca da empresa (imagens, documentos, áudios, uploads). Use para descobrir o que já foi criado antes. Você enxerga as duas pastas (cliente e agente).",
  async execute(input: SkillInput, ctx: SkillContext): Promise<{ assets: Array<AssetSummary> }> {
    const { folder, kind } = listAssetsInputSchema.parse(input);
    const assets = await listCompanyAssets(getDb(ctx.env), ctx.companyId, {
      kind,
      visibility: folder,
    });
    return { assets };
  },
  id: "listAssets",
  inputSchema: listAssetsInputSchema,
};

const readAssetInputSchema = z.object({
  assetId: z.string().min(1).describe("O id do asset (veja listAssets)."),
});

const readAssetSkill: UnknownSkill = {
  description:
    "Lê o conteúdo de um documento de texto da biblioteca (markdown, texto, JSON, CSV). Imagens e binários não podem ser lidos; referencie o asset pelo id.",
  async execute(
    input: SkillInput,
    ctx: SkillContext,
  ): Promise<{ content: string; name: string } | { error: string }> {
    const { assetId } = readAssetInputSchema.parse(input);
    const asset = await readAssetText(ctx.env, ctx.companyId, assetId);
    if (!asset) {
      return { error: "Asset não encontrado ou não é um documento de texto legível." };
    }
    return { content: asset.content, name: asset.name };
  },
  id: "readAsset",
  inputSchema: readAssetInputSchema,
};

const saveAssetInputSchema = z.object({
  content: z.string().min(1).describe("O conteúdo do arquivo (texto/markdown/SVG)."),
  folder: z
    .enum(["agent", "customer"])
    .optional()
    .describe(
      "'customer' (default) = entrega que o cliente vê na biblioteca; 'agent' = material de trabalho interno (rascunhos, recortes) que o cliente não vê.",
    ),
  mime: z
    .enum(["application/json", "image/svg+xml", "text/csv", "text/markdown", "text/plain"])
    .optional()
    .describe("Tipo do conteúdo. Use image/svg+xml para vetores. Default: text/markdown."),
  name: z.string().min(1).max(160).describe("Um nome claro para o arquivo."),
});

const saveAssetSkill: UnknownSkill = {
  description:
    "Salva um documento de texto na biblioteca da empresa. Use 'customer' para uma entrega final que o cliente deve ver, ou 'agent' para material de trabalho interno.",
  execute: (input: SkillInput, ctx: SkillContext): Promise<{ assetId: string }> => {
    const { content, folder, mime, name } = saveAssetInputSchema.parse(input);
    return persistAsset(ctx.env, {
      bytes: new TextEncoder().encode(content),
      companyId: ctx.companyId,
      kind: "knowledge_doc",
      metadata: { name },
      mime: mime ?? "text/markdown",
      uploadMetadata: { generatedBy: "agent" },
      visibility: folder ?? "customer",
    });
  },
  id: "saveAsset",
  inputSchema: saveAssetInputSchema,
};

export { listAssetsSkill, readAssetSkill, saveAssetSkill };
