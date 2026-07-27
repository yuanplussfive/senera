import { defineConfig } from "vitest/config";
import { IntegrationTestPolicy } from "./Scripts/TestCoveragePolicy.js";
import frontendConfig from "./vitest.config.ts";

export default defineConfig({
  ...frontendConfig,
  test: {
    ...frontendConfig.test,
    environment: "node",
    include: [...IntegrationTestPolicy.testInclude],
    setupFiles: [],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    fileParallelism: false,
  },
});
