import { jsonInit, request } from "@/lib/request";

const deleteAssets = async (ids: ReadonlyArray<string>): Promise<void> => {
  await request("/api/me/assets/delete", "POST /api/me/assets/delete", jsonInit("POST", { ids }));
};

export { deleteAssets };
