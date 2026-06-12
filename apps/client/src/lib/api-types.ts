// Shared response shapes for /api/v1/web-chat/*. Kept in one file so the
// chat UI components and query hooks stay in sync.

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
