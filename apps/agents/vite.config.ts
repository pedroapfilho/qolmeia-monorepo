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
          }
        },
      }),
    ],
    server: { host: "127.0.0.1", port: 8787 },
  };
});
