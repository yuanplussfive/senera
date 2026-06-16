import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { readVendorChunkName } from "./src/build/viteManualChunks";
import { resolveFrontendConfig } from "../Source/AgentSystem/AgentDefaults";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types";

const WorkspaceRoot = path.resolve(__dirname, "..");
const DefaultConfigFileName = "senera.config.json";

const frontendConfig = resolveFrontendConfig(readRootConfig());

export default defineConfig({
  plugins: [react()],
  define: {
    __SENERA_DEFAULT_WS_URL__: JSON.stringify(frontendConfig.Client.WebSocketUrl),
    __SENERA_DEFAULT_MODEL_LABEL__: JSON.stringify(frontendConfig.Client.ModelLabel),
    __SENERA_DEFAULT_USER_NAME__: JSON.stringify(frontendConfig.Client.UserName),
    __SENERA_EMPTY_SUGGESTIONS__: JSON.stringify(
      frontendConfig.Client.EmptySuggestions.join("|"),
    ),
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

function emptyRootConfig(): AgentSystemConfig {
  return {
    ModelProviders: [],
  };
}
