import { createAgentsApi, type AgentsApi } from "@repo/worker-api/internal";

type Database = AgentsApi;

const getDb = (env: Pick<Env, "API_INTERNAL_URL" | "INTERNAL_SHARED_SECRET">): Database =>
  createAgentsApi({ baseUrl: env.API_INTERNAL_URL, secret: env.INTERNAL_SHARED_SECRET });

export { getDb };
export type { Database };
