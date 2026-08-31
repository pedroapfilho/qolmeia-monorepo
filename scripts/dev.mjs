import { spawnSync } from "node:child_process";

import { applyPortlessUrls } from "./portless-env.mjs";

const env = applyPortlessUrls({
  API_INTERNAL_URL: ["qolmeia.api"],
  AUTH_SERVICE_URL: ["qolmeia.api"],
  BACKOFFICE_URL: ["qolmeia.backoffice"],
  CLIENT_ORIGINS: ["qolmeia.web", "qolmeia.backoffice"],
  CORS_ORIGINS: ["qolmeia.web", "qolmeia.backoffice"],
  WORKER_PUBLIC_URL: ["qolmeia.agents"],
});

const { status } = spawnSync("pnpm", ["exec", "turbo", "dev"], {
  env,
  stdio: "inherit",
});

process.exit(status ?? 1);
