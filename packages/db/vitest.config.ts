import nodeConfig from "@repo/config-vitest/node";
import { mergeConfig } from "vitest/config";

export default mergeConfig(nodeConfig, {
  test: {
    // Load DATABASE_URL and other secrets via dotenv before tests run.
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
