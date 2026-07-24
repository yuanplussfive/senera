import fs from "node:fs";
import path from "node:path";
import { startSeneraServer } from "./ServerRuntime.js";
import { createCompiledAgentMcpRuntimeModuleResolver } from "../Source/AgentSystem/Mcp/AgentMcpRuntimeModuleResolver.js";
import { syncRuntimeDirectory } from "./RuntimeAssetSync.js";
import {
  resolveFrontendConfig,
  resolveSandboxRuntimeConfig,
  resolveServerConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { loadConfigFile } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { writeAgentConfigJsonMirror } from "../Source/AgentSystem/Config/AgentConfigServicePaths.js";
import { moduleDirPath } from "../Source/AgentSystem/Core/AgentPath.js";
import { readAgentProductMetadata } from "../Source/AgentSystem/Core/AgentProductMetadata.js";
import { resolveAgentLocalAdminAccountPath } from "../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import { prepareAgentSandboxRuntime } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { synchronizeDockerAdminAccount } from "./DockerAdminAccountSync.js";

const AppRoot = resolveAppRoot();
const ProductVersion = readAgentProductMetadata(AppRoot).version;
const WorkspaceRoot = path.resolve(process.env.SENERA_WORKSPACE_ROOT?.trim() || "/data");
const ConfigPath = resolveWorkspacePath(process.env.AGENT_CONFIG_PATH?.trim() || "senera.config.json");
const FrontendRoot = path.join(AppRoot, "Frontend", "dist");
const ExampleConfigPath = path.join(AppRoot, "senera.config.example.json");
const RuntimeConfigFileName = "senera-runtime-config.js";
const PluginConfigFileName = "PluginConfig.toml";
const DockerUserPluginRoot = path.join(WorkspaceRoot, "Plugins");
const DockerPluginRoots = {
  System: [path.join(AppRoot, "System", "Plugins")],
  User: [DockerUserPluginRoot],
} as const;
const BundledDockerUserPluginRoot = path.join(AppRoot, "Plugins");
const DockerSandboxRuntime = {
  BaseDir: "/data/.senera/sandbox-runtime",
} as const;
await main();

async function main(): Promise<void> {
  fs.mkdirSync(WorkspaceRoot, { recursive: true });
  syncBundledUserPlugins();
  ensureFrontendBundleExists();
  ensureRuntimeConfigFile();

  const config = loadConfigFile(ConfigPath);
  const runtimeProjection = createDockerRuntimeProjection();
  const projectedConfig = runtimeProjection(config);
  await synchronizeDockerAdminAccount({
    accountFile: resolveAgentLocalAdminAccountPath(
      WorkspaceRoot,
      resolveServerConfig(projectedConfig).AccessControl.AccountFile,
    ),
    log: (message) => writeJsonLine({ kind: "senera.docker.admin.synchronized", message }),
  });
  await prepareDockerSandboxRuntime(projectedConfig);
  writeFrontendRuntimeConfig(projectedConfig);

  const server = startSeneraServer({
    workspaceRoot: WorkspaceRoot,
    configPath: ConfigPath,
    staticFrontendRoot: FrontendRoot,
    resourcesPath: AppRoot,
    runtimeModuleResolver: createCompiledAgentMcpRuntimeModuleResolver(AppRoot),
    runtimeConfigProjection: runtimeProjection,
    sandboxRuntimePrepared: true,
    productVersion: ProductVersion,
  });

  writeJsonLine({
    kind: "senera.docker.started",
    workspaceRoot: server.workspaceRoot,
    configPath: server.configPath,
    webUrl: `http://localhost:${resolveDockerPort()}`,
    websocketUrl: server.websocketUrl,
    sandboxRuntime: "required",
  });
}

function syncBundledUserPlugins(): void {
  syncRuntimeDirectory(BundledDockerUserPluginRoot, DockerUserPluginRoot, {
    preserveFileNames: [PluginConfigFileName],
  });
}

function ensureFrontendBundleExists(): void {
  const indexPath = path.join(FrontendRoot, "index.html");
  if (fs.existsSync(indexPath)) {
    return;
  }

  throw new Error(`容器前端产物缺失: ${indexPath}`);
}

function ensureRuntimeConfigFile(): void {
  if (fs.existsSync(ConfigPath)) {
    return;
  }

  const seedConfig = loadConfigFile(ExampleConfigPath);
  writeAgentConfigJsonMirror(seedConfig, ConfigPath);
}

function createDockerRuntimeProjection(): (config: AgentSystemConfig) => AgentSystemConfig {
  return (config) => ({
    ...config,
    PluginRoots: {
      System: [...DockerPluginRoots.System],
      User: [...DockerPluginRoots.User],
    },
    SandboxRuntime: {
      ...config.SandboxRuntime,
      ...DockerSandboxRuntime,
      Enabled: true,
      Provisioning: config.SandboxRuntime?.Provisioning ?? { Kind: "ReleaseBundle" },
    },
    Server: {
      ...config.Server,
      Host: resolveDockerHost(),
      Port: resolveDockerPort(),
      AccessControl: {
        ...config.Server?.AccessControl,
        AllowedOrigins: resolveDockerAllowedOrigins(),
        AllowInsecureHttp: resolveDockerAllowInsecureHttp(),
      },
    },
  });
}

async function prepareDockerSandboxRuntime(config: AgentSystemConfig): Promise<void> {
  try {
    await prepareAgentSandboxRuntime({
      workspaceRoot: WorkspaceRoot,
      config: resolveSandboxRuntimeConfig(config),
      productVersion: ProductVersion,
      log: (message) => writeJsonLine({ kind: "senera.docker.sandbox.prepare", message }),
      onProgress: (progress) => writeJsonLine({ kind: "senera.docker.sandbox.progress", progress }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Docker OS sandbox could not be prepared: ${detail}`, { cause: error });
  }
}

function writeFrontendRuntimeConfig(config: AgentSystemConfig): void {
  const frontend = resolveFrontendConfig(config);
  const runtimeConfig = {
    webSocketUrl: resolvePublicWebSocketUrl(),
    modelLabel: frontend.Client.ModelLabel,
    userName: frontend.Client.UserName,
    emptySuggestions: frontend.Client.EmptySuggestions,
  };

  fs.mkdirSync(FrontendRoot, { recursive: true });
  fs.writeFileSync(
    path.join(FrontendRoot, RuntimeConfigFileName),
    `window.__SENERA_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig, null, 2)};\nexport {};\n`,
    "utf8",
  );
}

function resolvePublicWebSocketUrl(): string {
  const configured = process.env.SENERA_PUBLIC_WS_URL?.trim();
  return configured && configured.length > 0 ? configured : "";
}

function resolveDockerHost(): string {
  return process.env.SENERA_SERVER_HOST?.trim() || "0.0.0.0";
}

function resolveDockerAllowedOrigins(): string[] {
  const configured = process.env.SENERA_ALLOWED_ORIGINS?.trim();
  if (!configured) {
    throw new Error("SENERA_ALLOWED_ORIGINS must declare at least one browser Origin.");
  }
  return configured
    .split(",")
    .map((value) => new URL(value.trim()).origin)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function resolveDockerAllowInsecureHttp(): boolean {
  const configured = process.env.SENERA_ALLOW_INSECURE_HTTP?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error("SENERA_ALLOW_INSECURE_HTTP must be either true or false.");
}

function resolveDockerPort(): number {
  return readPort(process.env.SENERA_SERVER_PORT, 8787);
}

function readPort(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : defaultValue;
}

function resolveWorkspacePath(value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(WorkspaceRoot, value);
}

function resolveAppRoot(): string {
  const currentDir = moduleDirPath(import.meta.url);
  const distSegment = `${path.sep}Dist${path.sep}`;
  const distIndex = currentDir.lastIndexOf(distSegment);
  return distIndex >= 0 ? currentDir.slice(0, distIndex) : path.resolve(currentDir, "..");
}

function writeJsonLine(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
