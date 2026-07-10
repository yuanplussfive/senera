import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: workspaceRoot,
  test: {
    environment: "node",
    globals: false,
    include: [
      "Scripts/E2ETests/**/*.test.ts",
    ],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    fileParallelism: false,
  },
});
