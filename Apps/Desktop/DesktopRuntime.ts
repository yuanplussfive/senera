import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import {
  isDesktopDataDirectory,
  readDesktopInstallationSelection,
  resolveDesktopInstallationSelectionPath,
  writeDesktopInstallationSelection,
  type DesktopInstallationSelection,
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
  installationAnchorPath: string;
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

export async function prepareDesktopRuntime(
  options: { installationAnchorPath?: string } = {},
): Promise<DesktopRuntimePaths> {
  const appRoot = resolveAppRoot();
  const resourceRoot = resolveDesktopResourceRoot({
    appPath: appRoot,
    isPackaged: app.isPackaged,
    launchRoot: process.cwd(),
  });
  const userDataRoot = app.getPath("userData");
  const installationAnchorPath = path.resolve(
    options.installationAnchorPath ?? resolveDesktopInstallationSelectionPath(userDataRoot),
  );
  const installationSelectionPath = resolveDesktopInstallationSelectionPath(userDataRoot);
  const installationSelection =
    readDesktopInstallationSelection(installationSelectionPath) ??
    readDesktopInstallationSelection(installationAnchorPath);
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
    else throw new DesktopInstallationSelectionRequiredError(installationAnchorPath);
  }
  const desktopDataRoot = path.join(userDataRoot, "runtime");
  const configDatabasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
  migrateLegacyAgentDatabaseFileFamily(path.join(desktopDataRoot, "Config.sqlite"), configDatabasePath);
  const configSeedPath = path.join(resourceRoot, ConfigTemplateFileName);
  const sandboxRuntimeRoot = path.join(desktopDataRoot, "SandboxRuntime");
  const sandboxWorkerEntrypoint = path.join(appRoot, "Dist", "Apps", "SandboxWorker.js");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });

  return {
    appRoot,
    resourceRoot,
    dataRoot: userDataRoot,
    desktopDataRoot,
    workspaceRoot,
    installationAnchorPath,
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

export async function chooseDesktopDataRoot(
  defaultPath = path.resolve(app.getPath("userData")),
): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "选择 Senera 数据目录",
    buttonLabel: "使用此目录",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
    message: "桌面运行时缓存、日志和本地应用状态将保存到此目录；项目会话状态仍保存在工作区的 .senera 目录。",
  });
  const selected = result.filePaths[0];
  return result.canceled || !selected || !isDesktopDataDirectory(selected) ? undefined : path.resolve(selected);
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
  persistDesktopInstallation(paths, { dataRoot: paths.dataRoot, workspaceRoot: resolved });
  return resolved;
}

export function persistDesktopInstallation(
  paths: DesktopRuntimePaths,
  selection: Omit<DesktopInstallationSelection, "version">,
): DesktopInstallationSelection {
  const dataRoot = path.resolve(selection.dataRoot);
  const workspaceRoot = path.resolve(selection.workspaceRoot);
  if (!isDesktopDataDirectory(dataRoot)) throw new DesktopDataResolutionError(dataRoot);
  if (!isDesktopWorkspaceDirectory(workspaceRoot)) throw new DesktopWorkspaceResolutionError(workspaceRoot);
  const normalized = { dataRoot, workspaceRoot };
  const selectionPaths = new Set([
    path.resolve(paths.installationAnchorPath),
    resolveDesktopInstallationSelectionPath(dataRoot),
  ]);
  for (const selectionPath of selectionPaths) {
    writeDesktopInstallationSelection(selectionPath, normalized);
  }
  return { version: 1, ...normalized };
}

export class DesktopDataResolutionError extends Error {
  constructor(readonly dataRoot: string) {
    super(`Desktop data directory does not exist or is not a directory: ${path.resolve(dataRoot)}`);
    this.name = "DesktopDataResolutionError";
  }
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
      `The Senera installer must initialize the desktop data and workspace directories before startup. Missing or invalid installation selection: ${path.resolve(selectionPath)}`,
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
