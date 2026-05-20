import { createHash } from "node:crypto";

import type { KnowledgeDocContentType, PrismaClient } from "@repo/db";

import { assetKey as defaultAssetKey, uploadAsset as defaultUpload } from "../lib/storage";

type CreatePrisma = Pick<PrismaClient, "knowledgeDoc">;

type CreateStorage = {
  assetKey: typeof defaultAssetKey;
  uploadAsset: typeof defaultUpload;
};

const extForContentType = (contentType: KnowledgeDocContentType): string => {
  if (contentType === "MARKDOWN") {
    return "md";
  }
  if (contentType === "JSON") {
    return "json";
  }
  return "txt";
};

const mimeForContentType = (contentType: KnowledgeDocContentType): string => {
  if (contentType === "MARKDOWN") {
    return "text/markdown";
  }
  if (contentType === "JSON") {
    return "application/json";
  }
  return "text/plain";
};

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// Creates a KnowledgeDoc: uploads content to R2 under
// org_<orgId>/knowledge/<sha256>.<ext> and inserts a row. Returns the
// created doc id + r2 key. Idempotent on (orgId, title) — if a doc with
// the same title already exists for the org, it is updated (the row
// summary/tags/contentType refresh and the R2 file is overwritten with
// the new content under a new sha-keyed path).
const createKnowledgeDoc = async (args: {
  content: string;
  contentType?: KnowledgeDocContentType;
  orgId: string;
  prisma: CreatePrisma;
  storage?: CreateStorage;
  summary: string;
  tags?: ReadonlyArray<string>;
  title: string;
}): Promise<{ id: string; r2Key: string }> => {
  const storage: CreateStorage = args.storage ?? {
    assetKey: defaultAssetKey,
    uploadAsset: defaultUpload,
  };
  const contentType = args.contentType ?? "MARKDOWN";
  const bytes = new TextEncoder().encode(args.content);
  const sha256 = sha256Hex(bytes);
  const ext = extForContentType(contentType);
  const r2Key = `org_${args.orgId}/knowledge/${sha256}.${ext}`;

  await storage.uploadAsset({ bytes, key: r2Key, mimeType: mimeForContentType(contentType) });

  // Upsert by (orgId, title) so seeds can be re-run idempotently.
  // We need a manual lookup since title alone isn't unique; the model
  // doesn't declare @@unique([orgId, title]) intentionally (titles are
  // human-editable). Use findFirst + create-or-update.
  const existing = await args.prisma.knowledgeDoc.findFirst({
    select: { id: true },
    where: { orgId: args.orgId, title: args.title },
  });

  if (existing) {
    const updated = await args.prisma.knowledgeDoc.update({
      data: {
        contentType,
        r2Key,
        size: bytes.byteLength,
        summary: args.summary,
        tags: args.tags ? [...args.tags] : [],
      },
      where: { id: existing.id },
    });
    return { id: updated.id, r2Key };
  }

  const created = await args.prisma.knowledgeDoc.create({
    data: {
      contentType,
      orgId: args.orgId,
      r2Key,
      size: bytes.byteLength,
      summary: args.summary,
      tags: args.tags ? [...args.tags] : [],
      title: args.title,
    },
  });
  return { id: created.id, r2Key };
};

export { createKnowledgeDoc };
export type { CreatePrisma, CreateStorage };
