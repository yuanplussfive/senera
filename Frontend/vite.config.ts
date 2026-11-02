import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { appearanceBootstrapPlugin } from "./src/build/appearanceBootstrapPlugin";
import { staticAssetCompressionPlugin } from "./src/build/viteStaticAssetCompression";
import { mobileAssetManifestPlugins } from "./src/build/mobileAssetManifestPlugin";
import { resolveFrontendConfig } from "../Source/AgentSystem/AgentDefaults";
import { DefaultAgentTimeZone } from "../Source/AgentSystem/Time/AgentTime";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes";
import { qqClientAliases, qqClientPlugins } from "./qq/build/vite";
import { AgentDevelopmentFrontendBase } from "../Source/AgentSystem/WebSocket/AgentDevelopmentFrontend";
import { AgentQqClientBuild } from "../Source/AgentSystem/Channels/Client/AgentQqClientBuildContract";

const WorkspaceRoot = path.resolve(__dirname, "..");
const DefaultConfigFileName = "senera.config.json";
const isComponentPreview = process.env.VITE_LADLE_APP_ID !== undefined;
const allApplicationEntries = [
  { name: "console", document: "index.html", module: "src/main.tsx" },
  { name: "mobile", document: "mobile/index.html", module: "src/mobile/main.tsx" },
  { name: "qq", document: "qq/index.html", module: "qq/main.ts" },
].map((entry) => ({
  name: entry.name,
  chunk: `${entry.name}-entry`,
  document: path.resolve(__dirname, entry.document).replaceAll("\\", "/"),
  module: path.resolve(__dirname, entry.module).replaceAll("\\", "/"),
}));
const applicationEntryChunks = new Map(allApplicationEntries.map((entry) => [entry.module, entry.chunk]));
const sharedModuleChunks = new Map(
  [
    {
      chunk: "console-core",
      modules: [
        "Frontend/src/api/authClient.ts",
        "Frontend/src/api/serverAuthentication.ts",
        "Frontend/src/lib/fileSize.ts",
        "Frontend/src/i18n/frontendMessageCatalog.ts",
        "Frontend/src/i18n/backendMessage.ts",
        "Frontend/src/i18n/frontendLocaleModel.ts",
        "Frontend/src/i18n/frontendLocaleStore.ts",
        "Frontend/src/i18n/messages/zh-CN.json",
        "Frontend/src/i18n/messages/en-US.json",
      ],
    },
    {
      chunk: "transport-runtime",
      modules: [
        "Frontend/src/api/agentTransportRetry.ts",
        "Packages/ResourceLinks/src/host.ts",
        "Frontend/src/api/agentTransportObserver.ts",
        "Frontend/src/api/eventCorrelation.ts",
        "Frontend/src/api/generatedEventCatalog.ts",
        "Source/AgentSystem/Auth/AgentAuthenticationProtocol.ts",
        "Frontend/src/app/desktopBridge.ts",
        "Frontend/src/app/mobileBridge.ts",
        "Frontend/src/features/settings/settingsSectionContract.ts",
        "Source/AgentSystem/Settings/AgentSettingsSectionContract.ts",
      ],
    },
    {
      chunk: "workspace-client",
      modules: [
        "Frontend/src/api/clientWebSocket.ts",
        "Frontend/src/api/connectionLifecycle.ts",
        "Source/AgentSystem/WebSocket/AgentWebSocketCloseContract.ts",
        "Frontend/src/api/connectionLiveness.ts",
        "Frontend/src/api/pendingRequests.ts",
        "Frontend/src/api/workspaceCatalogClient.ts",
        "Frontend/src/app/channelClientNavigation.ts",
        "Packages/ResourceLinks/src/download.ts",
        "Packages/ResourceLinks/src/resourceUrls.ts",
        "Packages/ResourceLinks/src/httpApiUrl.ts",
        "Packages/ResourceLinks/src/resourceUri.ts",
        "Packages/ResourceLinks/src/resourceContract.ts",
        "Packages/ResourceLinks/src/WorkspaceResourceLocator.ts",
        "Frontend/src/api/composerAttachmentDraft.ts",
        "Frontend/src/api/composerFileSelection.ts",
        "Frontend/src/api/attachmentUploadTask.ts",
        "Frontend/src/api/messageDraftRepository.ts",
        "Frontend/src/api/resourceUpload.ts",
        "Frontend/src/api/uploadClient.ts",
        "Frontend/src/api/uploadProgress.ts",
      ],
    },
    {
      chunk: "validation",
      modules: [
        "Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalogContract.ts",
        "Source/AgentSystem/Channels/AgentChannelClientRoutes.ts",
      ],
    },
    { chunk: "notifications", modules: ["Frontend/src/shared/ui/notifyError.ts"] },
  ].flatMap(({ chunk, modules }) =>
    modules.map((module) => [path.resolve(WorkspaceRoot, module).replaceAll("\\", "/"), chunk] as const),
  ),
);
sharedModuleChunks.set("\0commonjsHelpers.js", "transport-runtime");
sharedModuleChunks.set("\0vite/preload-helper.js", "transport-runtime");

const frontendConfig = resolveFrontendConfig(readRootConfig());
const rootPackageJson = readJsonFile<{ version?: string }>(path.resolve(WorkspaceRoot, "package.json"));
const frontendPackageJson = readJsonFile<{ version?: string }>(path.resolve(__dirname, "package.json"));

export default defineConfig(({ command, mode }) => {
  const qqBuild = mode === "qq-client";
  const applicationEntries = allApplicationEntries.filter((entry) =>
    qqBuild ? entry.name === "qq" : entry.name !== "qq",
  );
  return {
    base: command === "serve" && !isComponentPreview ? AgentDevelopmentFrontendBase : "./",
    // Ladle and the application resolve different dependency graphs. Their caches
    // must not overwrite each other's React modules while either server is running.
    cacheDir: path.resolve(__dirname, "node_modules/.vite", isComponentPreview ? "ladle" : "app"),
    plugins: [
      appearanceBootstrapPlugin(),
      react(),
      tailwindcss(),
      ...(isComponentPreview || (command === "build" && !qqBuild) ? [] : qqClientPlugins("qq")),
      staticAssetCompressionPlugin(),
      ...(isComponentPreview ? [] : mobileAssetManifestPlugins(applicationEntries.map((entry) => entry.chunk))),
      {
        name: "senera-document-entry-isolation",
        apply: "build",
        generateBundle(_options, bundle) {
          if (isComponentPreview) return;
          const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
          for (const application of applicationEntries) {
            const entry = chunks.find((chunk) => chunk.moduleIds.includes(application.module));
            if (!entry || entry.exports.length > 0)
              throw new Error(`${application.chunk} must remain an isolated startup module.`);
            if (
              chunks.some(
                (chunk) =>
                  chunk.facadeModuleId !== application.document &&
                  [...chunk.imports, ...chunk.dynamicImports].includes(entry.fileName),
              )
            ) {
              throw new Error(
                `Another module imports ${application.chunk}; documents must mount their own application.`,
              );
            }
          }
        },
      },
    ],
    build: {
      outDir: qqBuild ? path.resolve(WorkspaceRoot, AgentQqClientBuild.outputDirectory) : "dist",
      manifest: true,
      rollupOptions: isComponentPreview
        ? undefined
        : {
            input: {
              ...Object.fromEntries(applicationEntries.map((entry) => [entry.name, entry.document])),
            },
            // Keep shared transport, workspace and library boundaries stable across documents.
            // Size-based merging can pull a deferred screen into the bootstrap after unrelated edits.
            output: {
              onlyExplicitManualChunks: true,
              manualChunks(id) {
                const modulePath = id.replaceAll("\\", "/");
                const moduleChunk = applicationEntryChunks.get(modulePath) ?? sharedModuleChunks.get(modulePath);
                if (moduleChunk) return moduleChunk;
                if (modulePath.includes("/node_modules/zod/")) return "validation";
                if (modulePath.endsWith("/node_modules/zustand/esm/vanilla.mjs")) return "console-core";
                if (modulePath.includes("/node_modules/sonner/")) return "notifications";
              },
            },
          },
    },
    worker: {
      format: "es",
    },
    define: {
      // Production deployments discover their endpoint from runtime config or the page origin.
      "process.env.DRAGGABLE_DEBUG": "false",
      "import.meta.env.VITE_APP_HOSTED": JSON.stringify("true"),
      __SENERA_DEFAULT_WS_URL__: JSON.stringify(command === "serve" ? frontendConfig.Client.WebSocketUrl : ""),
      __SENERA_DEFAULT_MODEL_LABEL__: JSON.stringify(frontendConfig.Client.ModelLabel),
      __SENERA_DEFAULT_USER_NAME__: JSON.stringify(frontendConfig.Client.UserName),
      __SENERA_EMPTY_SUGGESTIONS__: JSON.stringify(frontendConfig.Client.EmptySuggestions.join("|")),
      __SENERA_DEFAULT_TIME_ZONE__: JSON.stringify(DefaultAgentTimeZone),
      __SENERA_APP_VERSION__: JSON.stringify(rootPackageJson.version ?? "0.0.0"),
      __SENERA_FRONTEND_VERSION__: JSON.stringify(frontendPackageJson.version ?? "0.0.0"),
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "@pierre/trees/react",
        "@pierre/diffs/react",
        "@codemirror/lang-json",
        "@codemirror/lang-markdown",
        "@codemirror/language",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/highlight",
        "@uiw/react-codemirror",
        "react-json-view-lite",
        "react-virtuoso",
      ],
    },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(__dirname, "./src"),
        ...qqClientAliases,
      },
    },
    server: {
      host: frontendConfig.DevServer.Host,
      port: frontendConfig.DevServer.Port,
      strictPort: frontendConfig.DevServer.StrictPort,
      proxy: {
        "/api": {
          target: new URL(frontendConfig.Client.WebSocketUrl.replace(/^ws/u, "http")).origin,
          ws: true,
        },
      },
    },
    preview: {
      host: frontendConfig.PreviewServer.Host,
      port: frontendConfig.PreviewServer.Port,
      strictPort: frontendConfig.PreviewServer.StrictPort,
    },
  };
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
