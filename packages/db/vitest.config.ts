import nodeConfig from "@repo/config-vitest/node";
import { mergeConfig } from "vitest/config";

export default mergeConfig(nodeConfig, {
  test: {
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
