import { createBrowserApi } from "@repo/worker-api";

const { apiGet, apiSend } = createBrowserApi(
  process.env.NEXT_PUBLIC_AGENTS_URL ?? "",
  "/api/backoffice",
);

export { apiGet, apiSend };
export { ApiError } from "@repo/worker-api";
