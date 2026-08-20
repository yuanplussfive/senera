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
  /** The selected workspace is the primary writable data root for desktop use. */
  dataRoot: string;
  /** Bootstrap-only root used to read the legacy installation pointer. */
  bootstrapDataRoot: string;
  desktopDataRoot: string;
  workspaceRoot: string;
  installationSelectionPath: string;
  configDatabasePath: string;
  configSeedPath: string;
  sandboxRuntimeRoot: string;
  upgradeStateRoot: string;
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
    resourcesPath: process.resourcesPath,
  });
  const bootstrapDataRoot = app.getPath("userData");
  const installationSelectionPath = resolveDesktopInstallationSelectionPath(bootstrapDataRoot);
  const installationSelection = readDesktopInstallationSelection(installationSelectionPath);
  const workspaceSelectionPath = resolveDesktopWorkspaceSelectionPath(bootstrapDataRoot);
  const configuredWorkspaceRoot = process.env.SENERA_WORKSPACE_ROOT?.trim();
  const persistedWorkspaceRoot = readLegacyDesktopWorkspaceSelection(workspaceSelectionPath, bootstrapDataRoot);
  const installationWorkspaceRoot =
    installationSelection && !sameDesktopPath(installationSelection.workspaceRoot, bootstrapDataRoot)
      ? installationSelection.workspaceRoot
      : undefined;
  let workspaceRoot = resolveDesktopWorkspaceRoot({
    isPackaged: app.isPackaged,
    resourceRoot,
    configuredWorkspaceRoot,
    persistedWorkspaceRoot: configuredWorkspaceRoot ?? installationWorkspaceRoot ?? persistedWorkspaceRoot,
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
  const workspaceLayout = resolveAgentWorkspaceLayout(workspaceRoot);
  const desktopDataRoot = workspaceLayout.desktopRuntimeRoot;
  const legacyDesktopDataRoot = path.join(bootstrapDataRoot, "runtime");
  const configDatabasePath = workspaceLayout.databases.config;
  migrateLegacyAgentDatabaseFileFamily(path.join(legacyDesktopDataRoot, "Config.sqlite"), configDatabasePath);
  migrateLegacyDesktopRuntime(legacyDesktopDataRoot, desktopDataRoot);
  moveFileIfTargetAbsent(path.join(bootstrapDataRoot, "desktop.log"), path.join(desktopDataRoot, "desktop.log"));
  const configSeedPath = path.join(resourceRoot, ConfigTemplateFileName);
  const sandboxRuntimeRoot = path.join(desktopDataRoot, "sandbox");
  const upgradeStateRoot = path.join(desktopDataRoot, "upgrades");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });
  app.setPath("userData", desktopDataRoot);
  app.setPath("sessionData", path.join(desktopDataRoot, "session"));

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
    dataRoot: workspaceRoot,
    bootstrapDataRoot,
    desktopDataRoot,
    workspaceRoot,
    installationSelectionPath,
    configDatabasePath,
    configSeedPath,
    sandboxRuntimeRoot,
    upgradeStateRoot,
    frontendIndexHtml: path.join(resourceRoot, "Frontend", "dist", "index.html"),
    windowIconPath: path.join(resourceRoot, "Apps", "Desktop", "Assets", DesktopIconFileName),
    logPath: path.join(desktopDataRoot, "desktop.log"),
  };
}

export async function chooseDesktopWorkspace(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "选择 Senera 工作区",
    buttonLabel: "使用此文件夹",
    properties: ["openDirectory", "createDirectory"],
    message: "选择或新建 Senera 工作区。项目数据、配置、会话和运行记录都会保存在这里。",
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

function migrateLegacyDesktopRuntime(sourceRoot: string, targetRoot: string): void {
  const normalizedSource = path.resolve(sourceRoot);
  const normalizedTarget = path.resolve(targetRoot);
  if (normalizedSource === normalizedTarget || !isDirectory(normalizedSource)) return;

  moveDirectoryContents(path.join(normalizedSource, ".senera"), path.join(normalizedTarget, "upgrades"));
  moveDirectoryContents(path.join(normalizedSource, "SandboxRuntime"), path.join(normalizedTarget, "sandbox"));
}

function moveDirectoryContents(sourceRoot: string, targetRoot: string): void {
  if (!isDirectory(sourceRoot)) return;
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (!fs.existsSync(target)) {
      fs.renameSync(source, target);
      continue;
    }
    if (entry.isDirectory() && isDirectory(target)) moveDirectoryContents(source, target);
  }
  if (fs.readdirSync(sourceRoot).length === 0) fs.rmSync(sourceRoot, { recursive: true, force: true });
}

function moveFileIfTargetAbsent(source: string, target: string): void {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
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
