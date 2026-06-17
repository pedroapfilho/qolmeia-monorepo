// Shared response shapes for the client app's REST surface (assets,
// activity pagination). The web-chat message/SSE types that used to live
// here left with the deleted sse-subscriber/composer components.

type WebChatAsset = {
  createdAt: string;
  id: string;
  // Asset kind: generated_image | brand_asset | user_upload | knowledge_doc | audio.
  kind: string;
  metadata: unknown;
  mimeType: string;
  // Human label (from metadata, original filename, or a kind stub).
  name: string;
  size: number;
  // Pre-signed URL for fetching the bytes. Short-lived (15min default) —
  // refetch the list to renew. Built server-side via buildSignedAssetUrl.
  url: string;
};

type ListResponse<T> = {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
};

export type { ListResponse, WebChatAsset };
