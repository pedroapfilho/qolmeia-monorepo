import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";
import zodCompiler from "zod-compiler/vite";

export default defineConfig(({ command }) => {
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
            config.vars = {
              ...config.vars,
              ...(process.env.API_INTERNAL_URL
                ? { API_INTERNAL_URL: process.env.API_INTERNAL_URL }
                : {}),
              ...(process.env.AUTH_SERVICE_URL
                ? { AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL }
                : {}),
              ...(process.env.CLIENT_ORIGINS ? { CLIENT_ORIGINS: process.env.CLIENT_ORIGINS } : {}),
              ...(process.env.WORKER_PUBLIC_URL
                ? { WORKER_PUBLIC_URL: process.env.WORKER_PUBLIC_URL }
                : {}),
            };
          }
        },
      }),
    ],
    server: {
      allowedHosts: [".localhost"],
      host: "127.0.0.1",
      port: Number(process.env.PORT) || 8787,
    },
  };
});
