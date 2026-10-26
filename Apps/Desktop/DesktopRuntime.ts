import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import {
  resolveDesktopApplicationRoot,
  resolveDesktopApplicationDataRoot,
  resolveDesktopResourceRoot,
  resolveDesktopWorkspaceRoot,
} from "./DesktopRuntimePathResolver.js";
import {
  isDesktopWorkspaceDirectory,
  readDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelectionPath,
  writeDesktopWorkspaceSelection,
} from "./DesktopWorkspaceSelection.js";
import {
  resolveAgentWorkspaceConfigPath,
  resolveAgentWorkspaceLayout,
} from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";

const { app, dialog } = electron;

export interface DesktopRuntimePaths {
  appRoot: string;
  resourceRoot: string;
  /** Fixed application root for shared configuration and Electron state. */
  dataRoot: string;
  desktopDataRoot: string;
  workspaceRoot: string;
  configDatabasePath: string;
  configSeedPath: string;
  configPath: string;
  sandboxRuntimeRoot: string;
  upgradeStateRoot: string;
  frontendIndexHtml: string;
  startupSurfaceHtml: string;
  windowIconPath: string;
  logPath: string;
}

const ConfigTemplateFileName = "senera.config.example.json";
const DesktopIconFileName = "senera-icon.png";

export async function prepareDesktopRuntime(): Promise<DesktopRuntimePaths> {
  const electronAppPath = resolveAppRoot();
  const resourceRoot = resolveDesktopResourceRoot({
    appPath: electronAppPath,
    isPackaged: app.isPackaged,
    launchRoot: process.cwd(),
    resourcesPath: process.resourcesPath,
  });
  const appRoot = resolveDesktopApplicationRoot({
    appPath: electronAppPath,
    isPackaged: app.isPackaged,
    resourceRoot,
  });
  const applicationDataRoot = resolveDesktopApplicationDataRoot();
  const workspaceSelectionPath = resolveDesktopWorkspaceSelectionPath(applicationDataRoot);
  const configuredWorkspaceRoot = process.env.SENERA_WORKSPACE_ROOT?.trim();
  const persistedWorkspaceRoot = readDesktopWorkspaceSelection(workspaceSelectionPath);
  let workspaceRoot = resolveDesktopWorkspaceRoot({
    resourceRoot,
    isPackaged: app.isPackaged,
    configuredWorkspaceRoot,
    persistedWorkspaceRoot,
  });
  if (!workspaceRoot || !isDesktopWorkspaceDirectory(workspaceRoot)) {
    if (configuredWorkspaceRoot) {
      throw new DesktopWorkspaceResolutionError(configuredWorkspaceRoot);
    }
    if (!app.isPackaged) workspaceRoot = resourceRoot;
    else {
      workspaceRoot = await chooseDesktopWorkspace();
      if (!workspaceRoot) throw new DesktopWorkspaceSelectionRequiredError(workspaceSelectionPath);
    }
  }
  const workspaceLayout = resolveAgentWorkspaceLayout(workspaceRoot);
  const desktopDataRoot = workspaceLayout.desktopRuntimeRoot;
  const configDatabasePath = workspaceLayout.databases.config;
  const configSeedPath = path.join(resourceRoot, ConfigTemplateFileName);
  const configPath = resolveAgentWorkspaceConfigPath(workspaceRoot);
  const sandboxRuntimeRoot = path.join(desktopDataRoot, "sandbox");
  const upgradeStateRoot = path.join(desktopDataRoot, "upgrades");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(desktopDataRoot, { recursive: true });
  app.setPath("userData", desktopDataRoot);
  app.setPath("sessionData", path.join(desktopDataRoot, "session"));

  return {
    appRoot,
    resourceRoot,
    dataRoot: applicationDataRoot,
    desktopDataRoot,
    workspaceRoot,
    configDatabasePath,
    configSeedPath,
    configPath,
    sandboxRuntimeRoot,
    upgradeStateRoot,
    frontendIndexHtml: path.join(resourceRoot, "Frontend", "dist", "index.html"),
    startupSurfaceHtml: path.join(resourceRoot, "Frontend", "dist", "startup.html"),
    windowIconPath: path.join(resourceRoot, "Apps", "Desktop", "Assets", DesktopIconFileName),
    logPath: path.join(desktopDataRoot, "desktop.log"),
  };
}

export async function chooseDesktopWorkspace(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "选择 Senera 工作区",
    buttonLabel: "使用此文件夹",
    properties: ["openDirectory", "createDirectory"],
    message: "选择或新建工作区。配置、会话、记忆和项目文件都会保存在该工作区中。",
  });
  const selected = result.filePaths[0];
  return result.canceled || !selected || !isDesktopWorkspaceDirectory(selected) ? undefined : path.resolve(selected);
}

export function persistDesktopWorkspace(paths: DesktopRuntimePaths, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  if (!isDesktopWorkspaceDirectory(resolved)) throw new DesktopWorkspaceResolutionError(resolved);
  writeDesktopWorkspaceSelection(resolveDesktopWorkspaceSelectionPath(paths.dataRoot), resolved);
  return resolved;
}

export class DesktopWorkspaceResolutionError extends Error {
  constructor(readonly workspaceRoot: string) {
    super(`Desktop workspace does not exist or is not a directory: ${path.resolve(workspaceRoot)}`);
    this.name = "DesktopWorkspaceResolutionError";
  }
}

export class DesktopWorkspaceSelectionRequiredError extends Error {
  constructor(readonly selectionPath: string) {
    super(
      `Senera requires a valid desktop workspace before startup. The workspace picker was canceled or the selection is missing: ${path.resolve(selectionPath)}`,
    );
    this.name = "DesktopWorkspaceSelectionRequiredError";
  }
}

const DesktopSessionMarkerFileName = "desktop.session";

/**
 * Desktop main has no supervisor: a crash that kills the process leaves no shutdown
 * record anywhere. The marker file is that record — written once the session reaches
 * readiness and removed on a clean quit, so a leftover marker means the previous run
 * died without finishing its shutdown.
 */
export function readDesktopSessionCrashed(paths: DesktopRuntimePaths): boolean {
  return fs.existsSync(desktopSessionMarkerPath(paths));
}

export function beginDesktopSession(paths: DesktopRuntimePaths): void {
  fs.writeFileSync(desktopSessionMarkerPath(paths), `${new Date().toISOString()} pid=${process.pid}\n`, "utf8");
}

export function endDesktopSession(paths: DesktopRuntimePaths): void {
  fs.rmSync(desktopSessionMarkerPath(paths), { force: true });
}

function desktopSessionMarkerPath(paths: DesktopRuntimePaths): string {
  return path.join(paths.desktopDataRoot, DesktopSessionMarkerFileName);
}

export function appendDesktopLog(logPath: string, message: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function resolveAppRoot(): string {
  return app.getAppPath();
}
