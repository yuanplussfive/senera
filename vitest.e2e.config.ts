import { defineConfig } from "vitest/config";
import { E2eTestPolicy } from "./Scripts/TestCoveragePolicy.js";
import frontendConfig from "./vitest.config.ts";

export default defineConfig({
  ...frontendConfig,
  test: {
    ...frontendConfig.test,
    environment: "node",
    include: [...E2eTestPolicy.testInclude],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    fileParallelism: false,
  },
});
