import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BackendTestCoveragePolicy } from "./Scripts/TestCoveragePolicy.js";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: workspaceRoot,
  test: {
    environment: "node",
    globals: false,
    include: [
      ...BackendTestCoveragePolicy.testInclude,
    ],
    coverage: {
      provider: "v8",
      reporter: [
        "text",
        "html",
        "json-summary",
      ],
      reportsDirectory: BackendTestCoveragePolicy.coverageDirectory,
      thresholds: BackendTestCoveragePolicy.thresholds,
      include: [...BackendTestCoveragePolicy.coverageInclude],
      exclude: [...BackendTestCoveragePolicy.coverageExclude],
    },
  },
});
