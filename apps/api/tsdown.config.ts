import path from "node:path";

import alias from "@rollup/plugin-alias";
import { defineConfig } from "tsdown";
import zodCompiler from "zod-compiler/rolldown";

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
    zodCompiler(),
    alias({
      entries: [{ find: "@", replacement: srcDir }],
    }),
  ],
  sourcemap: true,
  target: "node22",
  tsconfig: "tsconfig.json",
});
