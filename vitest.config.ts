import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import { FrontendTestCoveragePolicy } from "./Scripts/TestCoveragePolicy.js";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));
const workspacePath = (...segments: string[]): string => normalizePath(path.join(workspaceRoot, ...segments));
const workspacePaths = (values: readonly string[]): string[] =>
  values.map((value) => workspacePath(...value.split("/")));
const frontendTestDoubles = {
  "react-virtuoso": workspacePath("Scripts", "FrontendTests", "mocks", "react-virtuoso.mjs"),
  sonner: workspacePath("Scripts", "FrontendTests", "mocks", "sonner.mjs"),
} as const;

export default defineConfig({
  root: workspaceRoot,
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": workspacePath("Frontend", "src"),
      ...frontendTestDoubles,
    },
    dedupe: [
      "react",
      "react-dom",
    ],
  },
  ssr: {
    noExternal: [
      "react",
      "react-dom",
    ],
    optimizeDeps: {
      include: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/server",
      ],
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: [
      ...FrontendTestCoveragePolicy.testInclude,
    ],
    setupFiles: workspacePaths(FrontendTestCoveragePolicy.setupFiles ?? []),
    server: {
      deps: {
        inline: [
          /^react(?:\/.*)?$/,
          /^react-dom(?:\/.*)?$/,
        ],
      },
    },
    coverage: {
      provider: "v8",
      reporter: [
        "text",
        "html",
        "json-summary",
      ],
      reportsDirectory: FrontendTestCoveragePolicy.coverageDirectory,
      thresholds: FrontendTestCoveragePolicy.thresholds,
      include: [...FrontendTestCoveragePolicy.coverageInclude],
      exclude: [...FrontendTestCoveragePolicy.coverageExclude],
    },
  },
});
