import { spawnSync } from "node:child_process";

import { applyPortlessUrls } from "./portless-env.mjs";

const env = applyPortlessUrls({
  CORS_ORIGINS: ["qolmeia.web", "qolmeia.backoffice"],
});

const { status } = spawnSync("pnpm", ["exec", "turbo", "dev"], {
  env,
  stdio: "inherit",
});

process.exit(status ?? 1);
