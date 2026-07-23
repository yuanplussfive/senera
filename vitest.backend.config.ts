import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { BackendTestCoveragePolicy } from "./Scripts/TestCoveragePolicy.js";
import { resolveWorkspaceRoot } from "./Scripts/WorkspaceRoot.js";

const MAX_BACKEND_TEST_WORKERS = 4;
const workspaceRoot = resolveWorkspaceRoot();

export default defineConfig({
  root: workspaceRoot,
  test: {
    environment: "node",
    globals: false,
    maxWorkers: resolveBackendTestWorkerCount(),
    include: [...BackendTestCoveragePolicy.testInclude],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: BackendTestCoveragePolicy.coverageDirectory,
      thresholds: {
        ...BackendTestCoveragePolicy.thresholds,
        ...Object.fromEntries(
          (BackendTestCoveragePolicy.thresholdGroups ?? []).map((group) => [group.pattern, group.thresholds]),
        ),
      },
      include: [...BackendTestCoveragePolicy.coverageInclude],
      exclude: [...BackendTestCoveragePolicy.coverageExclude],
    },
  },
});

function resolveBackendTestWorkerCount(): number {
  return Math.max(1, Math.min(MAX_BACKEND_TEST_WORKERS, availableParallelism()));
}
