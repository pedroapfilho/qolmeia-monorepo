// Shared response shapes for the client app's REST surface (assets,
// activity pagination). The web-chat message/SSE types that used to live
// here left with the deleted sse-subscriber/composer components.

type WebChatAsset = {
  createdAt: string;
  id: string;
  metadata: unknown;
  mimeType: string;
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
