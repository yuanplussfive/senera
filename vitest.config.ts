import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import { FrontendTestCoveragePolicy } from "./Scripts/TestCoveragePolicy.js";
import { resolveWorkspaceRoot } from "./Scripts/WorkspaceRoot.js";

const workspaceRoot = resolveWorkspaceRoot();
const workspacePath = (...segments: string[]): string => normalizePath(path.resolve(workspaceRoot, ...segments));
const resolveFrontendDependency = createRequire(workspacePath("Frontend", "package.json")).resolve;
const xyflowPackageRoot = normalizePath(
  path.resolve(path.dirname(resolveFrontendDependency("@xyflow/react")), "../.."),
);
const frontendTestDoubles = {
  "react-virtuoso": workspacePath("Scripts", "FrontendTests", "mocks", "react-virtuoso.mjs"),
  sonner: workspacePath("Scripts", "FrontendTests", "mocks", "sonner.mjs"),
} as const;

export default defineConfig({
  root: workspaceRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": workspacePath("Frontend", "src"),
      "@xyflow/react": xyflowPackageRoot,
      ...frontendTestDoubles,
    },
    dedupe: ["react", "react-dom"],
  },
  ssr: {
    noExternal: ["react", "react-dom"],
    optimizeDeps: {
      include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/server"],
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: [...FrontendTestCoveragePolicy.testInclude],
    setupFiles: (FrontendTestCoveragePolicy.setupFiles ?? []).map((setupFile) => workspacePath(setupFile)),
    server: {
      deps: {
        inline: [/^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: FrontendTestCoveragePolicy.coverageDirectory,
      thresholds: FrontendTestCoveragePolicy.thresholds,
      include: [...FrontendTestCoveragePolicy.coverageInclude],
      exclude: [...FrontendTestCoveragePolicy.coverageExclude],
    },
  },
});
