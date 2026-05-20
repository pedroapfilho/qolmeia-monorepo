import { z } from "zod";

import { logger } from "../../lib/logger";
import { fetchAsset as defaultFetchAsset } from "../../lib/storage";

import { defineSkill } from "./types";

const readKnowledgeDocInput = z.object({
  docId: z.string().min(1),
});

type ReadKnowledgeDocInput = z.infer<typeof readKnowledgeDocInput>;

type ReadKnowledgeDocOutput =
  | { content: string; contentType: string; ok: true; title: string }
  | { error: string; ok: false };

const MAX_DOC_BYTES = 50_000;

const readKnowledgeDocSkill = defineSkill<ReadKnowledgeDocInput, ReadKnowledgeDocOutput>({
  description:
    "Leia o conteúdo completo de um documento de conhecimento (identificado pelo docId retornado por searchKnowledge). Use quando precisar dos detalhes que o resumo não capturou. Documentos maiores que 50 KB são truncados.",
  displayName: "Read Knowledge Doc",
  execute: async ({ docId }, ctx) => {
    try {
      // Validate the doc belongs to the calling org.
      const doc = await ctx.prisma.knowledgeDoc.findFirst({
        select: { contentType: true, r2Key: true, title: true },
        where: { id: docId, orgId: ctx.orgId },
      });
      if (!doc) {
        return { error: `Documento ${docId} não encontrado para esta organização.`, ok: false };
      }

      const bytes = await defaultFetchAsset(doc.r2Key);
      const truncated = bytes.byteLength > MAX_DOC_BYTES;
      const useBytes = truncated ? bytes.slice(0, MAX_DOC_BYTES) : bytes;
      const content = new TextDecoder().decode(useBytes);
      return {
        content: truncated
          ? `${content}\n\n[... documento truncado, ${bytes.byteLength} bytes total]`
          : content,
        contentType: doc.contentType,
        ok: true,
        title: doc.title,
      };
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      logger.error({ docId, error: message, orgId: ctx.orgId }, "readKnowledgeDoc.failed");
      return { error: message, ok: false };
    }
  },
  id: "readKnowledgeDoc",
  inputSchema: readKnowledgeDocInput,
  requiredConnectorTypes: [],
  requiresApprovalDefault: false,
});

export { readKnowledgeDocSkill };
export type { ReadKnowledgeDocInput, ReadKnowledgeDocOutput };
