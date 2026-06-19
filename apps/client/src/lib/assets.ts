// Client-side asset mutations for the gallery (`/api/me/assets`). The list
// itself is fetched server-side (app/(client)/assets/page.tsx via apiGetServer);
// only deletes happen from the browser, so this module is intentionally small.

const AGENTS_URL = process.env.NEXT_PUBLIC_AGENTS_URL ?? "";

const apiUrl = (path: string): string => `${AGENTS_URL}${path}`;

// Deletes one or many gallery assets. The server scopes the delete to the
// company's own customer-folder assets, so a single id and a bulk selection
// share the same endpoint.
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
