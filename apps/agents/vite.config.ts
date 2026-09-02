import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { applyPortlessUrls } from "@repo/portless-env";
import { defineConfig } from "vite";
import zodCompiler from "zod-compiler/vite";

const DEV_VARS = ["API_INTERNAL_URL", "AUTH_SERVICE_URL", "CLIENT_ORIGINS", "WORKER_PUBLIC_URL"];

export default defineConfig(({ command }) => {
  applyPortlessUrls({
    API_INTERNAL_URL: ["qolmeia.api"],
    AUTH_SERVICE_URL: ["qolmeia.api"],
    CLIENT_ORIGINS: ["qolmeia.web", "qolmeia.backoffice"],
    WORKER_PUBLIC_URL: ["qolmeia.agents"],
  });
  const fluePlugins = flue();
  const applyFlueWorkerConfig = flueWorkerConfig();

  return {
    plugins: [
      zodCompiler(),
      fluePlugins,
      cloudflare({
        config: (config) => {
          applyFlueWorkerConfig(config);
          if (command === "serve") {
            Reflect.deleteProperty(config, "ai");
            Reflect.deleteProperty(config, "vectorize");
            for (const key of DEV_VARS) {
              const value = process.env[key];
              if (value) {
                config.vars[key] = value;
              }
            }
          }
        },
      }),
    ],
    server: { allowedHosts: [".localhost"], host: "127.0.0.1", port: 8787 },
  };
});
