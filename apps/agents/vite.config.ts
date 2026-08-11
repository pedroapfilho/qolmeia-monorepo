import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
  server: { host: "127.0.0.1", port: 8787 },
});
