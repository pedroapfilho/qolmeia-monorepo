import type { PrismaClient } from "@repo/db";

import type { NormalizedAttachment, NormalizedMessage } from "../connectors/types";
import { ingestBrandAsset as ingestBrandAssetDefault } from "../knowledge/brand-asset";
import { logger } from "../lib/logger";

const MAX_IMAGE_BYTES = 20_000_000;

type AttachmentsPrisma = Pick<PrismaClient, "brandAsset">;

type AttachmentBytesFetcher = (attachment: NormalizedAttachment) => Promise<Uint8Array | null>;

type AttachmentsDeps = {
  fetchAttachmentBytes?: AttachmentBytesFetcher;
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

// Default fetcher used when the normalized attachment ships only a URL. Per-
// adapter overrides (e.g., a Telegram getFile dance) flow through the
// `fetchAttachmentBytes` dep.
const defaultFetchAttachmentBytes: AttachmentBytesFetcher = async (attachment) => {
  if (attachment.bytes) {
    return attachment.bytes;
  }
  if (!attachment.url) {
    return null;
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`attachment fetch failed: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
};

const isAudio = (attachment: NormalizedAttachment): boolean =>
  attachment.kind === "audio" || (attachment.mimeType ?? "").startsWith("audio");

const isImage = (attachment: NormalizedAttachment): boolean =>
  attachment.kind === "image" || (attachment.mimeType ?? "").startsWith("image");

type ImageResult =
  | { assetId: string; bytes: Uint8Array; deduped: boolean; kind: "ok"; mimeType: string }
  | { kind: "oversize" }
  | { kind: "skip" };

const processImage = async ({
  attachment,
  deps,
  externalThreadId,
  fetchAttachmentBytes,
  messageExternalId,
  orgId,
}: {
  attachment: NormalizedAttachment;
  deps: AttachmentsDeps;
  externalThreadId: string;
  fetchAttachmentBytes: AttachmentBytesFetcher;
  messageExternalId: string;
  orgId: string;
}): Promise<ImageResult> => {
  const ingestBrandAsset = deps.ingestBrandAsset ?? ingestBrandAssetDefault;

  let bytes: Uint8Array | null;
  try {
    bytes = await fetchAttachmentBytes(attachment);
  } catch (error) {
    logger.error(
      { chatId: externalThreadId, error, messageId: messageExternalId },
      "image.download_failed",
    );
    return { kind: "skip" };
  }
  if (!bytes) {
    return { kind: "skip" };
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { kind: "oversize" };
  }
  const mimeType = attachment.mimeType ?? "application/octet-stream";
  try {
    const { assetId, deduped } = await ingestBrandAsset({
      bytes,
      mimeType,
      orgId,
      prisma: deps.prisma as PrismaClient,
    });
    return { assetId, bytes, deduped, kind: "ok", mimeType };
  } catch (error) {
    logger.error(
      { chatId: externalThreadId, error, messageId: messageExternalId },
      "image.ingest_failed",
    );
    return { kind: "skip" };
  }
};

const processIncomingAttachments = async ({
  deps,
  normalizedMessage,
  orgId,
}: {
  deps: AttachmentsDeps;
  normalizedMessage: NormalizedMessage;
  orgId: string;
}): Promise<ProcessedAttachments> => {
  const fetchAttachmentBytes = deps.fetchAttachmentBytes ?? defaultFetchAttachmentBytes;
  const attachments = normalizedMessage.attachments;
  const audio = attachments.find(isAudio);
  const hasAudio = audio !== undefined;
  const images = attachments.filter(isImage);

  const imageResults = await Promise.allSettled(
    images.map((attachment) =>
      processImage({
        attachment,
        deps,
        externalThreadId: normalizedMessage.externalThreadId,
        fetchAttachmentBytes,
        messageExternalId: normalizedMessage.externalId,
        orgId,
      }),
    ),
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

const fetchAudioBytes = ({
  deps,
  normalizedMessage,
}: {
  deps: AttachmentsDeps;
  normalizedMessage: NormalizedMessage;
}): Promise<Uint8Array | null> => {
  const audio = normalizedMessage.attachments.find(isAudio);
  if (!audio) {
    return Promise.resolve(null);
  }
  const fetchAttachmentBytes = deps.fetchAttachmentBytes ?? defaultFetchAttachmentBytes;
  return fetchAttachmentBytes(audio);
};

export { fetchAudioBytes, MAX_IMAGE_BYTES, processIncomingAttachments };
export type { AttachmentBytesFetcher, AttachmentsDeps, ProcessedAttachments };
