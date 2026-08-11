import path from "node:path";

import alias from "@rollup/plugin-alias";
import { defineConfig } from "tsdown";

const srcDir = path.resolve(process.cwd(), "src");

export default defineConfig({
  clean: true,
  deps: {
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
