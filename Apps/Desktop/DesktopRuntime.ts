import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import {
  isCurrentDesktopInstallationSelection,
  readDesktopInstallationSelection,
  resolveDesktopInstallationSelectionPath,
  writeDesktopInstallationSelection,
} from "./DesktopInstallationSelection.js";
import { resolveDesktopResourceRoot, resolveDesktopWorkspaceRoot } from "./DesktopRuntimePathResolver.js";
import {
  isDesktopWorkspaceDirectory,
  readLegacyDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelectionPath,
} from "./DesktopWorkspaceSelection.js";
import {
  migrateLegacyAgentDatabaseFileFamily,
  resolveAgentWorkspaceLayout,
} from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const { app, dialog } = electron;

export interface DesktopRuntimePaths {
  appRoot: string;
  resourceRoot: string;
  dataRoot: string;
  desktopDataRoot: string;
  workspaceRoot: string;
  installationSelectionPath: string;
  configDatabasePath: string;
  configSeedPath: string;
  sandboxRuntimeRoot: string;
  sandboxWorkerEntrypoint: string;
  frontendIndexHtml: string;
  windowIconPath: string;
  logPath: string;
}

const ConfigTemplateFileName = "senera.config.example.json";
const DesktopIconFileName = "senera-icon.png";

export async function prepareDesktopRuntime(): Promise<DesktopRuntimePaths> {
  const appRoot = resolveAppRoot();
  const resourceRoot = resolveDesktopResourceRoot({
    appPath: appRoot,
    isPackaged: app.isPackaged,
    launchRoot: process.cwd(),
  });
  const userDataRoot = app.getPath("userData");
  const installationSelectionPath = resolveDesktopInstallationSelectionPath(userDataRoot);
  const installationSelection = readDesktopInstallationSelection(installationSelectionPath);
  const workspaceSelectionPath = resolveDesktopWorkspaceSelectionPath(userDataRoot);
  const configuredWorkspaceRoot = process.env.SENERA_WORKSPACE_ROOT?.trim();
  const persistedWorkspaceRoot = readLegacyDesktopWorkspaceSelection(workspaceSelectionPath, userDataRoot);
  let workspaceRoot = resolveDesktopWorkspaceRoot({
    isPackaged: app.isPackaged,
    resourceRoot,
    configuredWorkspaceRoot,
    persistedWorkspaceRoot: configuredWorkspaceRoot ?? installationSelection?.workspaceRoot ?? persistedWorkspaceRoot,
  });
  if (!workspaceRoot || !isDesktopWorkspaceDirectory(workspaceRoot)) {
    if (configuredWorkspaceRoot) {
      throw new DesktopWorkspaceResolutionError(configuredWorkspaceRoot);
    }
    if (!app.isPackaged) workspaceRoot = resourceRoot;
    else {
      workspaceRoot = await chooseDesktopWorkspace();
      if (!workspaceRoot) throw new DesktopInstallationSelectionRequiredError(installationSelectionPath);
    }
  }
  const desktopDataRoot = path.join(userDataRoot, "runtime");
  const configDatabasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
  migrateLegacyAgentDatabaseFileFamily(path.join(desktopDataRoot, "Config.sqlite"), configDatabasePath);
  const configSeedPath = path.join(resourceRoot, ConfigTemplateFileName);
  const sandboxRuntimeRoot = path.join(desktopDataRoot, "SandboxRuntime");
  const sandboxWorkerEntrypoint = path.join(appRoot, "Dist", "Apps", "SandboxWorker.js");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });

  const installationSelectionIsCurrent =
    isCurrentDesktopInstallationSelection(installationSelectionPath) &&
    installationSelection !== undefined &&
    sameDesktopPath(installationSelection.workspaceRoot, workspaceRoot);
  if (app.isPackaged && !configuredWorkspaceRoot && !installationSelectionIsCurrent) {
    writeDesktopInstallationSelection(installationSelectionPath, { workspaceRoot });
  }

  return {
    appRoot,
    resourceRoot,
    dataRoot: userDataRoot,
    desktopDataRoot,
    workspaceRoot,
    installationSelectionPath,
    configDatabasePath,
    configSeedPath,
    sandboxRuntimeRoot,
    sandboxWorkerEntrypoint,
    frontendIndexHtml: path.join(resourceRoot, "Frontend", "dist", "index.html"),
    windowIconPath: path.join(resourceRoot, "Apps", "Desktop", "Assets", DesktopIconFileName),
    logPath: path.join(userDataRoot, "desktop.log"),
  };
}

export async function chooseDesktopWorkspace(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "选择 Senera 工作区",
    buttonLabel: "使用此文件夹",
    properties: ["openDirectory", "createDirectory"],
    message: "选择要让 Senera 读取、搜索和执行工具的项目目录。",
  });
  const selected = result.filePaths[0];
  return result.canceled || !selected || !isDesktopWorkspaceDirectory(selected) ? undefined : path.resolve(selected);
}

export function persistDesktopWorkspace(paths: DesktopRuntimePaths, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  if (!isDesktopWorkspaceDirectory(resolved)) throw new DesktopWorkspaceResolutionError(resolved);
  writeDesktopInstallationSelection(paths.installationSelectionPath, { workspaceRoot: resolved });
  return resolved;
}

export class DesktopWorkspaceResolutionError extends Error {
  constructor(readonly workspaceRoot: string) {
    super(`Desktop workspace does not exist or is not a directory: ${path.resolve(workspaceRoot)}`);
    this.name = "DesktopWorkspaceResolutionError";
  }
}

export class DesktopInstallationSelectionRequiredError extends Error {
  constructor(readonly selectionPath: string) {
    super(
      `Senera requires a valid desktop workspace before startup. The workspace picker was canceled or the selection is missing: ${path.resolve(selectionPath)}`,
    );
    this.name = "DesktopInstallationSelectionRequiredError";
  }
}

export function appendDesktopLog(logPath: string, message: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function resolveAppRoot(): string {
  return app.getAppPath();
}

function sameDesktopPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}
