const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

const apiUrl = (path: string): string => `${AGENTS_URL}${path}`;

const deleteAssets = async (ids: ReadonlyArray<string>): Promise<void> => {
  const res = await fetch(apiUrl("/api/me/assets/delete"), {
    body: JSON.stringify({ ids }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`POST /api/me/assets/delete failed (${res.status})`);
  }
};

export { deleteAssets };
