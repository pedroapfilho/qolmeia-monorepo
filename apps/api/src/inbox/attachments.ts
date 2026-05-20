import type { PrismaClient } from "@repo/db";

import { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import { logger } from "../lib/logger";

import type { IncomingAttachment, IncomingMessage } from "./ingest";

const MAX_IMAGE_BYTES = 20_000_000;

type AttachmentsPrisma = Pick<PrismaClient, "brandAsset">;

type AttachmentsDeps = {
  ingestBrandAsset?: typeof ingestBrandAssetDefault;
  prisma: AttachmentsPrisma;
};

type ProcessedAttachments = {
  audioBytes?: Uint8Array;
  audioMime?: string;
  hasAudio: boolean;
  imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
  newAssets: Array<{ assetId: string; deduped: boolean; mimeType: string }>;
  oversizeCount: number;
};

const findAudioAttachment = (attachments: ReadonlyArray<IncomingAttachment>) =>
  attachments.find((a) => (a.mimeType ?? "").startsWith("audio"));

const findImageAttachments = (attachments: ReadonlyArray<IncomingAttachment>) =>
  attachments.filter((a) => (a.mimeType ?? "").startsWith("image"));

type ImageResult =
  | { assetId: string; bytes: Uint8Array; deduped: boolean; kind: "ok"; mimeType: string }
  | { kind: "oversize" }
  | { kind: "skip" };

const processImage = async ({
  chatId,
  deps,
  img,
  messageId,
  orgId,
}: {
  chatId: string;
  deps: AttachmentsDeps;
  img: IncomingAttachment;
  messageId: string;
  orgId: string;
}): Promise<ImageResult> => {
  const ingestBrandAsset = deps.ingestBrandAsset ?? ingestBrandAssetDefault;

  if (!img.fetchData) {
    return { kind: "skip" };
  }
  let bytes: Uint8Array;
  try {
    bytes = await img.fetchData();
  } catch (error) {
    logger.error({ chatId, error, messageId }, "image.download_failed");
    return { kind: "skip" };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { kind: "oversize" };
  }
  const mimeType = img.mimeType ?? "application/octet-stream";
  try {
    const { assetId, deduped } = await ingestBrandAsset({
      bytes,
      mimeType,
      orgId,
      prisma: deps.prisma as PrismaClient,
    });
    return { assetId, bytes, deduped, kind: "ok", mimeType };
  } catch (error) {
    logger.error({ chatId, error, messageId }, "image.ingest_failed");
    return { kind: "skip" };
  }
};

const processIncomingAttachments = async ({
  chatId,
  deps,
  message,
  orgId,
}: {
  chatId: string;
  deps: AttachmentsDeps;
  message: IncomingMessage;
  orgId: string;
}): Promise<ProcessedAttachments> => {
  const attachments = message.attachments ?? [];
  const audio = findAudioAttachment(attachments);
  const hasAudio = audio !== undefined;
  const images = findImageAttachments(attachments);

  const imageResults = await Promise.allSettled(
    images.map((img) => processImage({ chatId, deps, img, messageId: message.id, orgId })),
  );

  const newAssets: Array<{ assetId: string; deduped: boolean; mimeType: string }> = [];
  const imageBytes: Array<{ assetId: string; bytes: Uint8Array; mimeType: string }> = [];
  let oversizeCount = 0;

  for (const settled of imageResults) {
    if (settled.status === "rejected") {
      continue;
    }
    const r = settled.value;
    if (r.kind === "oversize") {
      oversizeCount += 1;
    } else if (r.kind === "ok") {
      newAssets.push({ assetId: r.assetId, deduped: r.deduped, mimeType: r.mimeType });
      if (!r.deduped) {
        imageBytes.push({ assetId: r.assetId, bytes: r.bytes, mimeType: r.mimeType });
      }
    }
  }

  return {
    audioMime: audio?.mimeType,
    hasAudio,
    imageBytes,
    newAssets,
    oversizeCount,
  };
};

export { MAX_IMAGE_BYTES, processIncomingAttachments };
export type { AttachmentsDeps, ProcessedAttachments };
