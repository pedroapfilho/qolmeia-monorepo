type WebChatAsset = {
  createdAt: string;
  id: string;
  kind: string;
  metadata: unknown;
  mimeType: string;
  name: string;
  size: number;
  url: string;
};

type ListResponse<T> = {
  items: ReadonlyArray<T>;
  nextCursor: string | null;
};

export type { ListResponse, WebChatAsset };
