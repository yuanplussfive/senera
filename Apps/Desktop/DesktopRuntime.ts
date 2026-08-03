import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import { syncRuntimeDirectory } from "../RuntimeAssetSync.js";
import { resolveDesktopResourceRoot, resolveDesktopWorkspaceRoot } from "./DesktopRuntimePathResolver.js";
import {
  resolveAgentSandboxDevelopmentBundleRoot,
  resolveAgentSandboxPackagedBundleRoot,
} from "../../Source/AgentSystem/Sandbox/AgentSandboxBundlePaths.js";
import {
  migrateLegacyAgentDatabaseFileFamily,
  resolveAgentWorkspaceLayout,
} from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const { app } = electron;

export interface DesktopRuntimePaths {
  appRoot: string;
  resourceRoot: string;
  desktopDataRoot: string;
  workspaceRoot: string;
  configDatabasePath: string;
  configSeedPath: string;
  sandboxRuntimeRoot: string;
  sandboxBundleRoot: string;
  microsandboxRuntimeBridgePath: string;
  frontendIndexHtml: string;
  windowIconPath: string;
  logPath: string;
}

const ConfigTemplateFileName = "senera.config.example.json";
const DesktopIconFileName = "senera-icon.png";
const MicrosandboxRuntimeBridgePath = ["Dist", "Apps", "Desktop", "DesktopMicrosandboxRuntimeBridge.js"];

export function prepareDesktopRuntime(): DesktopRuntimePaths {
  const appRoot = resolveAppRoot();
  const resourceRoot = resolveDesktopResourceRoot({
    appPath: appRoot,
    isPackaged: app.isPackaged,
    launchRoot: process.cwd(),
  });
  const userDataRoot = app.getPath("userData");
  const workspaceRoot = resolveDesktopWorkspaceRoot({
    isPackaged: app.isPackaged,
    resourceRoot,
    userDataRoot,
  });
  const desktopDataRoot = path.join(userDataRoot, "runtime");
  const configDatabasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
  migrateLegacyAgentDatabaseFileFamily(path.join(desktopDataRoot, "Config.sqlite"), configDatabasePath);
  const configSeedPath = path.join(resourceRoot, ConfigTemplateFileName);
  const sandboxRuntimeRoot = path.join(desktopDataRoot, "SandboxRuntime");
  const sandboxBundleRoot = app.isPackaged
    ? resolveAgentSandboxPackagedBundleRoot(process.resourcesPath)
    : resolveAgentSandboxDevelopmentBundleRoot(resourceRoot);
  const microsandboxRuntimeBridgePath = path.join(
    app.isPackaged ? unpackedAppRoot(appRoot) : appRoot,
    ...MicrosandboxRuntimeBridgePath,
  );
  const bundledTerminalRuntimeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "TerminalSidecarRuntime")
    : path.join(resourceRoot, ".senera", "sandbox-runtime", "terminal-sidecar");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });
  syncRuntimeDirectory(bundledTerminalRuntimeRoot, path.join(sandboxRuntimeRoot, "terminal-sidecar"), {
    pruneExtraneous: true,
  });

  return {
    appRoot,
    resourceRoot,
    desktopDataRoot,
    workspaceRoot,
    configDatabasePath,
    configSeedPath,
    sandboxRuntimeRoot,
    sandboxBundleRoot,
    microsandboxRuntimeBridgePath,
    frontendIndexHtml: path.join(resourceRoot, "Frontend", "dist", "index.html"),
    windowIconPath: path.join(resourceRoot, "Apps", "Desktop", "Assets", DesktopIconFileName),
    logPath: path.join(userDataRoot, "desktop.log"),
  };
}

export function appendDesktopLog(logPath: string, message: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function resolveAppRoot(): string {
  return app.getAppPath();
}

function unpackedAppRoot(appRoot: string): string {
  return appRoot.endsWith(".asar") ? appRoot.replace(/\.asar$/i, ".asar.unpacked") : appRoot;
}
