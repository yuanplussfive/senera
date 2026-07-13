import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { appearanceBootstrapPlugin } from "./src/build/appearanceBootstrapPlugin";
import { readVendorChunkName } from "./src/build/viteManualChunks";
import { resolveFrontendConfig } from "../Source/AgentSystem/AgentDefaults";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes";

const WorkspaceRoot = path.resolve(__dirname, "..");
const DefaultConfigFileName = "senera.config.json";

const frontendConfig = resolveFrontendConfig(readRootConfig());
const rootPackageJson = readJsonFile<{ version?: string }>(path.resolve(WorkspaceRoot, "package.json"));
const frontendPackageJson = readJsonFile<{ version?: string }>(path.resolve(__dirname, "package.json"));

export default defineConfig({
  base: "./",
  plugins: [appearanceBootstrapPlugin(), react()],
  define: {
    __SENERA_DEFAULT_WS_URL__: JSON.stringify(frontendConfig.Client.WebSocketUrl),
    __SENERA_DEFAULT_MODEL_LABEL__: JSON.stringify(frontendConfig.Client.ModelLabel),
    __SENERA_DEFAULT_USER_NAME__: JSON.stringify(frontendConfig.Client.UserName),
    __SENERA_EMPTY_SUGGESTIONS__: JSON.stringify(frontendConfig.Client.EmptySuggestions.join("|")),
    __SENERA_APP_VERSION__: JSON.stringify(rootPackageJson.version ?? "0.0.0"),
    __SENERA_FRONTEND_VERSION__: JSON.stringify(frontendPackageJson.version ?? "0.0.0"),
  },
  optimizeDeps: {
    include: [
      "@codemirror/lang-json",
      "@codemirror/lang-markdown",
      "@codemirror/language",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/highlight",
      "@uiw/react-codemirror",
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return readVendorChunkName(id);
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: frontendConfig.DevServer.Host,
    port: frontendConfig.DevServer.Port,
    strictPort: frontendConfig.DevServer.StrictPort,
  },
  preview: {
    host: frontendConfig.PreviewServer.Host,
    port: frontendConfig.PreviewServer.Port,
    strictPort: frontendConfig.PreviewServer.StrictPort,
  },
});

function readRootConfig(): AgentSystemConfig {
  const configuredPath = process.env.AGENT_CONFIG_PATH?.trim();
  const configPath = configuredPath
    ? path.resolve(WorkspaceRoot, configuredPath)
    : path.resolve(WorkspaceRoot, DefaultConfigFileName);

  if (!fs.existsSync(configPath)) {
    return emptyRootConfig();
  }

  return {
    ...emptyRootConfig(),
    ...JSON.parse(fs.readFileSync(configPath, "utf8")),
  } as AgentSystemConfig;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function emptyRootConfig(): AgentSystemConfig {
  return {
    ModelProviders: [],
  };
}
