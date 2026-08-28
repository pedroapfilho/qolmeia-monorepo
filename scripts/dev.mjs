import { spawn } from "node:child_process";

import { applyPortlessUrls } from "./portless-env.mjs";

applyPortlessUrls({
  AGENTS_INTERNAL_URL: "qolmeia.agents",
  API_INTERNAL_URL: "qolmeia.api",
  AUTH_SERVICE_INTERNAL_URL: "qolmeia.api",
  AUTH_SERVICE_URL: "qolmeia.api",
  BACKOFFICE_URL: "qolmeia.backoffice",
  CLIENT_ORIGINS: ["qolmeia.web", "qolmeia.backoffice"],
  CORS_ORIGINS: ["qolmeia.web", "qolmeia.landing", "qolmeia.backoffice"],
  NEXT_PUBLIC_LANDING_URL: "qolmeia.landing",
  NEXT_PUBLIC_WEB_APP_URL: "qolmeia.web",
  WEB_APP_URL: "qolmeia.web",
  WORKER_PUBLIC_URL: "qolmeia.agents",
});

const child = spawn("pnpm", ["exec", "turbo", "dev"], { env: process.env, stdio: "inherit" });
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
