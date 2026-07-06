import path from "node:path";

import alias from "@rollup/plugin-alias";
import { defineConfig } from "tsdown";

const srcDir = path.resolve(process.cwd(), "src");

export default defineConfig({
  clean: true,
  deps: {
    // Workspace packages export .ts source — Node can't import those at runtime
    // (its native TS loader rejects extensionless relative imports), so tsdown
    // must bundle every @repo/* package into the output rather than leave them
    // as external imports. Regex (not a name list) so new workspace deps are
    // covered automatically.
    alwaysBundle: [/^@repo\//v],
  },
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  plugins: [
    alias({
      entries: [{ find: "@", replacement: srcDir }],
    }),
  ],
  sourcemap: true,
  target: "node22",
  tsconfig: "tsconfig.json",
});
