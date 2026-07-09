import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const workspaceRoot = path.resolve(__dirname);

export default defineConfig({
  root: workspaceRoot,
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.join(workspaceRoot, "Frontend", "src"),
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
      "Scripts/FrontendTests/**/*.test.mjs",
    ],
    setupFiles: [
      path.join(workspaceRoot, "Scripts", "FrontendTests", "setup.ts"),
    ],
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
      reportsDirectory: "coverage/frontend",
      include: [
        "Frontend/src/api/streamingEventCoalescer.ts",
        "Frontend/src/api/useAgentSocket.ts",
        "Frontend/src/features/chat/ApprovalRequestStrip.tsx",
        "Frontend/src/features/chat/ChatHeader.tsx",
        "Frontend/src/features/chat/EmptyChatState.tsx",
        "Frontend/src/features/chat/messagePresentation.ts",
        "Frontend/src/features/chat/modelProvider.ts",
        "Frontend/src/features/workflow/canvasLoadPolicy.ts",
        "Frontend/src/features/workflow/runSummary.ts",
        "Frontend/src/features/workflow/stepPresentation.ts",
        "Frontend/src/shared/code/CodeArtifactModel.ts",
        "Frontend/src/shared/code/CodeArtifactSourceView.tsx",
        "Frontend/src/shared/motion/index.ts",
        "Frontend/src/shared/motion/presets.ts",
        "Frontend/src/shared/responsive/index.ts",
        "Frontend/src/shared/responsive/responsiveMode.ts",
        "Frontend/src/shared/responsive/responsiveStore.ts",
        "Frontend/src/store/session/**/*.ts",
        "Frontend/src/store/sessionStore.ts",
      ],
      exclude: [
        "Frontend/src/main.tsx",
        "Frontend/src/generated/**",
        "Frontend/src/**/*.d.ts",
      ],
    },
  },
});
