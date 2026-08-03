import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

// `#/*` subpath imports resolve via package.json "imports" (Node + Vite native),
// so no resolve.alias is needed.
export default defineConfig({
  // flue() must run before cloudflare(), and flueWorkerConfig() is how the
  // generated Worker entry plus the per-agent Durable Object bindings reach the
  // Cloudflare plugin (merged into .flue-vite.wrangler.jsonc).
  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
  // Port 8787 is baked into AGENTS_INTERNAL_URL, WORKER_PUBLIC_URL and the
  // Next rewrites in apps/client (Vite would default to 5173). The explicit
  // IPv4 host matters just as much: Vite binds [::1] for "localhost", but
  // `wrangler dev` bound 127.0.0.1 and Node resolves "localhost" to ::1
  // first, so the Next rewrites would miss the server entirely.
  server: { host: "127.0.0.1", port: 8787 },
});
