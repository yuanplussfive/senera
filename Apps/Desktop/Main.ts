import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { startSeneraServer, type SeneraServerHandle } from "../ServerRuntime.js";
import { appendDesktopLog, prepareDesktopRuntime, type DesktopRuntimePaths } from "./DesktopRuntime.js";
import {
  createDesktopFrontendSource,
  loadDesktopFrontend,
  type DesktopFrontendSource,
} from "./DesktopFrontendSource.js";
import { projectDesktopRuntimeConfig } from "./DesktopRuntimeConfig.js";
import { loadConfigFile } from "../../Source/AgentSystem/Config/AgentConfigService.js";
import { isTrustedDesktopNavigation, resolveExternalHttpUrl } from "./DesktopNavigationPolicy.js";
import { DesktopClosePolicy, type DesktopCloseIntent } from "./DesktopClosePolicy.js";
import { hideDesktopWindows, showDesktopWindows } from "./DesktopWindowVisibility.js";

let serverHandle: SeneraServerHandle | undefined;
let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let desktopTray: Tray | undefined;
let forceSettingsWindowClose = false;
let desktopQuitting = false;
const settingsClosePolicy = new DesktopClosePolicy();
let runtimePaths: DesktopRuntimePaths | undefined;
let frontendSource: DesktopFrontendSource | undefined;
const desktopModuleDir = path.dirname(fileURLToPath(import.meta.url));
const remoteDebuggingPort = process.env.SENERA_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();

const settingsSectionIds = new Set([
  "model-service",
  "default-model",
  "system",
  "runtime",
  "planning",
  "retrieval",
  "storage",
  "general",
  "appearance",
  "skills",
  "about",
]);

app.setName("Senera");
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}
Menu.setApplicationMenu(null);

app
  .whenReady()
  .then(() => {
    runtimePaths = prepareDesktopRuntime();
    appendDesktopLog(
      runtimePaths.logPath,
      `starting desktop runtime workspace=${runtimePaths.workspaceRoot} configDatabase=${runtimePaths.configDatabasePath}`,
    );
    const paths = runtimePaths;
    desktopTray = createDesktopTray(paths.windowIconPath);
    frontendSource = createDesktopFrontendSource({
      devServerUrl: process.env.SENERA_DESKTOP_FRONTEND_URL,
      frontendIndexHtml: paths.frontendIndexHtml,
    });
    registerDesktopIpc();
    const seedConfig = loadConfigFile(paths.configSeedPath);
    serverHandle = startSeneraServer({
      workspaceRoot: paths.workspaceRoot,
      configSource: {
        kind: "sqlite",
        databasePath: paths.configDatabasePath,
        seedConfig,
        label: paths.configDatabasePath,
      },
      runtimeConfigProjection: (config) => projectDesktopRuntimeConfig(paths, config),
    });
    mainWindow = createMainWindow();
    void loadDesktopFrontend(mainWindow, frontendSource);

    app.on("activate", () => {
      showAllDesktopWindows();
    });
  })
  .catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const logPath = runtimePaths?.logPath ?? path.join(app.getPath("userData"), "desktop.log");
    appendDesktopLog(logPath, `startup failed\n${message}`);
    dialog.showErrorBox("Senera 启动失败", message);
    app.exit(1);
  });

app.on("before-quit", (event) => {
  if (!desktopQuitting && requestDirtySettingsConfirmation("quit")) {
    event.preventDefault();
    return;
  }
  desktopQuitting = true;
  forceSettingsWindowClose = true;
  desktopTray?.destroy();
  desktopTray = undefined;
  serverHandle?.stop();
  serverHandle = undefined;
});

function registerDesktopIpc(): void {
  ipcMain.handle("senera:settings.open", (_event, options?: { section?: string }) => {
    openSettingsWindow(options);
  });
  ipcMain.handle("senera:settings.dirty", (event, dirty: boolean) => {
    if (settingsWindow && event.sender === settingsWindow.webContents) {
      settingsClosePolicy.setDirty(Boolean(dirty));
    }
  });
  ipcMain.handle("senera:settings.confirm-close", (event) => {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return;
    const closeIntent = settingsClosePolicy.confirm();
    forceSettingsWindowClose = true;
    settingsWindow.close();
    if (closeIntent === "main") {
      mainWindow?.close();
    } else if (closeIntent === "quit") {
      desktopQuitting = true;
      app.quit();
    }
  });
  ipcMain.handle("senera:settings.cancel-close", (event) => {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return;
    settingsClosePolicy.cancel();
  });
  ipcMain.handle("senera:window.minimize", (event) => {
    resolveManagedWindow(event)?.minimize();
  });
  ipcMain.handle("senera:window.toggle-maximize", (event) => {
    const target = resolveManagedWindow(event);
    if (!target) return undefined;
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
    return readWindowState(target);
  });
  ipcMain.handle("senera:window.close", (event) => {
    if (!resolveManagedWindow(event)) return;
    hideAllDesktopWindows();
  });
  ipcMain.handle("senera:window.get-state", (event) => {
    const target = resolveManagedWindow(event);
    return target ? readWindowState(target) : undefined;
  });
}

function resolveSettingsSection(section: string | undefined): string {
  if (!settingsSectionIds.has(section ?? "")) return "model-service";
  return section as string;
}

function createDesktopTray(iconPath: string): Tray {
  const tray = new Tray(iconPath);
  tray.setToolTip("Senera");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 Senera",
        click: showAllDesktopWindows,
      },
      { type: "separator" },
      {
        label: "退出 Senera",
        click: () => app.quit(),
      },
    ]),
  );
  tray.on("click", showAllDesktopWindows);
  return tray;
}

function hideAllDesktopWindows(): void {
  hideDesktopWindows([mainWindow, settingsWindow]);
}

function showAllDesktopWindows(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    void loadDesktopFrontend(mainWindow, readFrontendSource());
  }
  showDesktopWindows([mainWindow, settingsWindow]);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0f172a",
    title: "Senera",
    icon: runtimePaths?.windowIconPath,
    autoHideMenuBar: true,
    ...readWindowFrameOptions(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopModuleDir, "Preload.cjs"),
      sandbox: true,
    },
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle("Senera");
  });
  registerNavigationPolicy(window, readFrontendSource());
  registerWindowStateEvents(window);
  window.on("close", (event) => {
    if (desktopQuitting) return;
    event.preventDefault();
    hideAllDesktopWindows();
  });
  window.on("closed", () => {
    mainWindow = undefined;
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      forceSettingsWindowClose = true;
      settingsWindow.close();
    }
  });
  return window;
}

function openSettingsWindow(options?: { section?: string }): void {
  if (!runtimePaths) return;
  const source = readFrontendSource();
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    void loadDesktopFrontend(mainWindow, source);
  }
  const section = resolveSettingsSection(options?.section);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    if (!settingsClosePolicy.dirty) {
      void loadDesktopFrontend(settingsWindow, source, {
        surface: "settings",
        section,
      });
    }
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#f7f8f6",
    title: "Senera 设置",
    show: false,
    autoHideMenuBar: true,
    icon: runtimePaths.windowIconPath,
    ...readWindowFrameOptions(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopModuleDir, "Preload.cjs"),
      sandbox: true,
    },
  });

  settingsClosePolicy.reset();
  forceSettingsWindowClose = false;
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });
  settingsWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    settingsWindow?.setTitle("Senera 设置");
  });
  registerWindowStateEvents(settingsWindow);
  registerNavigationPolicy(settingsWindow, source);
  settingsWindow.on("close", (event) => {
    if (forceSettingsWindowClose || !settingsClosePolicy.dirty) return;
    event.preventDefault();
    requestDirtySettingsConfirmation("settings");
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    settingsClosePolicy.reset();
    forceSettingsWindowClose = false;
  });

  void loadDesktopFrontend(settingsWindow, source, {
    surface: "settings",
    section,
  });
}

function readWindowFrameOptions(): { frame: false } | { titleBarStyle: "hiddenInset" } {
  return process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : { frame: false };
}

function resolveManagedWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  const target = BrowserWindow.fromWebContents(event.sender);
  return target && (target === mainWindow || target === settingsWindow) ? target : undefined;
}

function readWindowState(window: BrowserWindow): { isMaximized: boolean } {
  return { isMaximized: window.isMaximized() };
}

function registerWindowStateEvents(window: BrowserWindow): void {
  const publishState = (): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send("senera:window.state-changed", readWindowState(window));
  };
  window.on("maximize", publishState);
  window.on("unmaximize", publishState);
}

function requestDirtySettingsConfirmation(intent: DesktopCloseIntent): boolean {
  if (!settingsWindow || settingsWindow.isDestroyed() || !settingsClosePolicy.request(intent)) return false;
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  settingsWindow.show();
  settingsWindow.focus();
  settingsWindow.webContents.send("senera:settings.request-close");
  return true;
}

function registerNavigationPolicy(window: BrowserWindow, source: DesktopFrontendSource): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedDesktopNavigation(url, source)) return;
    event.preventDefault();
    openExternalHttpUrl(url);
  });
}

function openExternalHttpUrl(value: string): void {
  const url = resolveExternalHttpUrl(value);
  if (!url) return;
  void shell.openExternal(url).catch((error) => {
    if (!runtimePaths) return;
    appendDesktopLog(runtimePaths.logPath, "external navigation failed url=" + url + " error=" + String(error));
  });
}

function readFrontendSource(): DesktopFrontendSource {
  if (!frontendSource) {
    throw new Error("Desktop frontend source has not been initialized.");
  }
  return frontendSource;
}
