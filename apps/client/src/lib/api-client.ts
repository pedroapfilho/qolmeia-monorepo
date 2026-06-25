import { createBrowserApi } from "@repo/worker-api";

const { apiSendForm } = createBrowserApi(process.env.NEXT_PUBLIC_AGENTS_URL ?? "");

export { apiSendForm };
export { ApiError } from "@repo/worker-api";
