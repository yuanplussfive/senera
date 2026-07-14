import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { BackendTestCoveragePolicy } from "./Scripts/TestCoveragePolicy.js";

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
      thresholds: BackendTestCoveragePolicy.thresholds,
      include: [...BackendTestCoveragePolicy.coverageInclude],
      exclude: [...BackendTestCoveragePolicy.coverageExclude],
    },
  },
});

function resolveBackendTestWorkerCount(): number {
  return Math.max(1, Math.min(MAX_BACKEND_TEST_WORKERS, availableParallelism()));
}

function resolveWorkspaceRoot(): string {
  const configDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), path.resolve(process.cwd(), ".."), configDir, path.resolve(configDir, "..")];
  const root = candidates.find(
    (candidate) => existsSync(path.join(candidate, "Frontend", "src")) && existsSync(path.join(candidate, "Source")),
  );

  if (!root) {
    throw new Error("Unable to resolve Senera workspace root for backend Vitest config.");
  }
  return root;
}
