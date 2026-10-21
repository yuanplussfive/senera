import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, type IpcMainInvokeEvent } from "electron";
import {
  appendDesktopLog,
  chooseDesktopWorkspace,
  persistDesktopWorkspace,
  prepareDesktopRuntime,
  type DesktopRuntimePaths,
} from "./DesktopRuntime.js";
import {
  createDesktopFrontendSource,
  loadDesktopFrontend,
  type DesktopFrontendSource,
} from "./DesktopFrontendSource.js";
import { DesktopServerHost, type DesktopServerHandle } from "./DesktopServerHost.js";
import { isTrustedDesktopNavigation } from "./DesktopNavigationPolicy.js";
import { DesktopClosePolicy, type DesktopCloseIntent } from "./DesktopClosePolicy.js";
import { hideDesktopWindows, showDesktopWindows } from "./DesktopWindowVisibility.js";
import { desktopMessage } from "./DesktopMessageCatalog.js";
import {
  DesktopExternalUrlPolicy,
  resolveAgentExternalUrl,
} from "../../Source/AgentSystem/Interaction/AgentExternalUrlPolicy.js";
import { DesktopUpdateService } from "./DesktopUpdateService.js";
import type { DesktopUpdateSnapshot } from "./DesktopUpdateProtocol.js";
import { readAgentProductMetadata } from "../../Source/AgentSystem/Core/AgentProductMetadata.js";
import { resolveAgentWorkspaceConfigPath } from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import {
  isAgentSettingsSectionId,
  type AgentSettingsSectionId,
} from "../../Source/AgentSystem/Settings/AgentSettingsSectionContract.js";

let serverHandle: DesktopServerHandle | undefined;
let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let settingsWindowReady = false;
let settingsSurfaceReady = false;
let pendingSettingsSection: AgentSettingsSectionId | undefined;
let desktopTray: Tray | undefined;
let forceSettingsWindowClose = false;
let desktopQuitting = false;
const settingsClosePolicy = new DesktopClosePolicy();
let runtimePaths: DesktopRuntimePaths | undefined;
let frontendSource: DesktopFrontendSource | undefined;
let desktopUpdateService: DesktopUpdateService | undefined;
let pendingUpdateInstall = false;
let desktopStartupReady = false;
let pendingDesktopActivation = false;
const desktopModuleDir = path.dirname(fileURLToPath(import.meta.url));
const remoteDebuggingPort = process.env.SENERA_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();

app.setName("Senera");
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}
Menu.setApplicationMenu(null);

const ownsDesktopInstance = app.requestSingleInstanceLock();

if (!ownsDesktopInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!desktopStartupReady) {
      pendingDesktopActivation = true;
      return;
    }
    showAllDesktopWindows();
  });

  app
    .whenReady()
    .then(async () => {
      runtimePaths = await prepareDesktopRuntime();
      appendDesktopLog(
        runtimePaths.logPath,
        `starting desktop runtime dataRoot=${runtimePaths.dataRoot} workspace=${runtimePaths.workspaceRoot} resources=${runtimePaths.resourceRoot} config=${runtimePaths.configPath}`,
      );
      const paths = runtimePaths;
      desktopTray = createDesktopTray(paths.windowIconPath, () => {
        requestDesktopWorkspaceSelection();
      });
      frontendSource = createDesktopFrontendSource({
        devServerUrl: process.env.SENERA_DESKTOP_FRONTEND_URL,
        frontendIndexHtml: paths.frontendIndexHtml,
      });
      registerDesktopIpc();
      const product = readAgentProductMetadata(paths.appRoot);
      desktopUpdateService = new DesktopUpdateService({
        isPackaged: app.isPackaged,
        currentVersion: app.getVersion(),
        updateOrigin: product.updateOrigin,
        publishLog: (message) => appendDesktopLog(paths.logPath, message),
        onStateChanged: publishDesktopUpdateState,
      });
      mainWindow = createMainWindow({ navigationSource: false });
      await loadDesktopStartupSurface(mainWindow);
      mainWindow.show();
      const desktopServer = await DesktopServerHost.start({
        bootstrap: {
          workspaceRoot: paths.workspaceRoot,
          applicationStateRoot: paths.dataRoot,
          applicationRoot: paths.appRoot,
          resourcesRoot: paths.resourceRoot,
          upgradeStateRoot: paths.upgradeStateRoot,
          upgradeDataRoots: [paths.desktopDataRoot],
          configPath: paths.configPath,
          legacyConfigPath: resolveAgentWorkspaceConfigPath(paths.dataRoot),
        },
        onWorkspaceOpened: (root, workspaceId) => {
          persistDesktopWorkspace(paths, root);
          if (runtimePaths) runtimePaths = { ...runtimePaths, workspaceRoot: root };
          if (serverHandle) {
            const url = new URL(serverHandle.websocketUrl);
            url.searchParams.set("workspaceId", workspaceId);
            serverHandle = { ...serverHandle, workspaceRoot: root, websocketUrl: url.toString() };
          }
        },
      });
      serverHandle = desktopServer.currentHandle();
      registerNavigationPolicy(mainWindow, frontendSource);
      await loadDesktopFrontend(mainWindow, frontendSource, desktopFrontendQuery());
      desktopStartupReady = true;
      void desktopUpdateService.start();

      app.on("activate", () => {
        showAllDesktopWindows();
      });

      if (pendingDesktopActivation) {
        pendingDesktopActivation = false;
        showAllDesktopWindows();
      }
    })
    .catch(async (error) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      const logPath = runtimePaths?.logPath ?? path.join(app.getPath("userData"), "desktop.log");
      appendDesktopLog(logPath, `startup failed\n${message}`);
      dialog.showErrorBox(desktopMessage("startup.failedTitle", {}, app.getLocale()), message);
      app.exit(1);
    });
}

app.on("before-quit", (event) => {
  if (!desktopQuitting && requestDirtySettingsConfirmation("quit")) {
    event.preventDefault();
    return;
  }
  desktopQuitting = true;
  forceSettingsWindowClose = true;
  desktopTray?.destroy();
  desktopTray = undefined;
  const handle = serverHandle;
  serverHandle = undefined;
  if (!handle) return;
  event.preventDefault();
  void handle.stop().finally(() => {
    app.quit();
  });
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
  ipcMain.handle("senera:settings.surface-ready", (event) => {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return;
    settingsSurfaceReady = true;
    flushSettingsSectionNavigation();
  });
  ipcMain.handle("senera:settings.confirm-close", (event) => {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return;
    const closeIntent = settingsClosePolicy.confirm();
    const installPendingUpdate = pendingUpdateInstall;
    pendingUpdateInstall = false;
    forceSettingsWindowClose = true;
    settingsWindow.close();
    if (installPendingUpdate) {
      desktopUpdateService?.installUpdate();
      return;
    }
    if (closeIntent === "main") {
      mainWindow?.close();
    } else if (closeIntent === "quit") {
      app.quit();
    }
  });
  ipcMain.handle("senera:settings.cancel-close", (event) => {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return;
    settingsClosePolicy.cancel();
    pendingUpdateInstall = false;
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
    const target = resolveManagedWindow(event);
    if (!target) return;
    if (target === settingsWindow) {
      if (requestDirtySettingsConfirmation("settings")) return;
      forceSettingsWindowClose = true;
      target.close();
      return;
    }
    hideAllDesktopWindows();
  });
  ipcMain.handle("senera:window.get-state", (event) => {
    const target = resolveManagedWindow(event);
    return target ? readWindowState(target) : undefined;
  });
  ipcMain.handle("senera:external-url.open", async (_event, input: string) => {
    const external = resolveAgentExternalUrl(input, DesktopExternalUrlPolicy);
    await shell.openExternal(external.url, { activate: true });
  });
  ipcMain.handle("senera:workspace.choose-folder", async (event) => {
    if (!resolveManagedWindow(event)) return null;
    return (await chooseDesktopWorkspace()) ?? null;
  });
  ipcMain.handle("senera:update.get-state", () => desktopUpdateService?.getSnapshot());
  ipcMain.handle("senera:update.check", () => desktopUpdateService?.checkForUpdates());
  ipcMain.handle("senera:update.download", () => desktopUpdateService?.downloadUpdate());
  ipcMain.handle("senera:update.install", () => requestDesktopUpdateInstall());
}

function requestDesktopUpdateInstall(): DesktopUpdateSnapshot | undefined {
  const service = desktopUpdateService;
  if (!service) return undefined;
  if (settingsClosePolicy.dirty && requestDirtySettingsConfirmation("quit")) {
    pendingUpdateInstall = true;
    return service.getSnapshot();
  }
  return service.installUpdate();
}

function resolveSettingsSection(section: string | undefined): AgentSettingsSectionId {
  return isAgentSettingsSectionId(section) ? section : "model-service";
}

function createDesktopTray(iconPath: string, onSelectWorkspace: () => void): Tray {
  const tray = new Tray(iconPath);
  tray.setToolTip("Senera");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: desktopMessage("tray.show", {}, app.getLocale()),
        click: showAllDesktopWindows,
      },
      {
        label: desktopMessage("tray.selectWorkspace", {}, app.getLocale()),
        click: onSelectWorkspace,
      },
      { type: "separator" },
      {
        label: desktopMessage("tray.quit", {}, app.getLocale()),
        click: () => app.quit(),
      },
    ]),
  );
  tray.on("click", showAllDesktopWindows);
  return tray;
}

function requestDesktopWorkspaceSelection(): void {
  showAllDesktopWindows();
  mainWindow?.webContents.send("senera:workspace.request-folder");
}

function hideAllDesktopWindows(): void {
  hideDesktopWindows([mainWindow, settingsWindow]);
}

function showAllDesktopWindows(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    startDesktopFrontendLoad(mainWindow);
  }
  showDesktopWindows([mainWindow, settingsWindow], mainWindow);
}

function createMainWindow({ navigationSource = true }: { navigationSource?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0f172a",
    title: "Senera",
    icon: runtimePaths?.windowIconPath,
    show: false,
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
  if (navigationSource) registerNavigationPolicy(window, readFrontendSource());
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
    startDesktopFrontendLoad(mainWindow);
  }
  const section = resolveSettingsSection(options?.section);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindowReady) presentSettingsWindow({ focus: false });
    if (!settingsClosePolicy.dirty) requestSettingsSectionNavigation(section);
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 620,
    backgroundColor: "#f7f8f6",
    title: desktopMessage("settings.title", {}, app.getLocale()),
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
  settingsWindowReady = false;
  settingsSurfaceReady = false;
  pendingSettingsSection = section;
  settingsWindow.once("ready-to-show", () => {
    settingsWindowReady = true;
    presentSettingsWindow({ focus: true });
  });
  settingsWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    settingsWindow?.setTitle(desktopMessage("settings.title", {}, app.getLocale()));
  });
  settingsWindow.webContents.on("did-start-loading", () => {
    settingsSurfaceReady = false;
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
    settingsWindowReady = false;
    settingsSurfaceReady = false;
    pendingSettingsSection = undefined;
    settingsClosePolicy.reset();
    forceSettingsWindowClose = false;
  });

  startDesktopFrontendLoad(settingsWindow, {
    surface: "settings",
    section,
  });
}

function requestSettingsSectionNavigation(section: AgentSettingsSectionId): void {
  pendingSettingsSection = section;
  flushSettingsSectionNavigation();
}

function flushSettingsSectionNavigation(): void {
  const window = settingsWindow;
  const section = pendingSettingsSection;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !settingsSurfaceReady || !section) return;
  pendingSettingsSection = undefined;
  if (settingsClosePolicy.dirty) return;
  window.webContents.send("senera:settings.navigate", section);
}

function presentSettingsWindow({ focus }: { focus: boolean }): void {
  const window = settingsWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (focus) {
    window.show();
    window.moveTop();
    window.focus();
  } else if (!window.isVisible()) {
    window.showInactive();
  }
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
  presentSettingsWindow({ focus: true });
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
  let externalUrl: string;
  try {
    externalUrl = resolveAgentExternalUrl(value, DesktopExternalUrlPolicy).url;
  } catch (error) {
    if (runtimePaths) {
      appendDesktopLog(runtimePaths.logPath, "blocked external navigation: " + String(error));
    }
    return;
  }
  void shell.openExternal(externalUrl, { activate: true }).catch((error) => {
    if (!runtimePaths) return;
    appendDesktopLog(runtimePaths.logPath, "external navigation failed url=" + externalUrl + " error=" + String(error));
  });
}

function readFrontendSource(): DesktopFrontendSource {
  if (!frontendSource) {
    throw new Error("Desktop frontend source has not been initialized.");
  }
  return frontendSource;
}

function desktopFrontendQuery(query: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    webSocketUrl: serverHandle?.websocketUrl,
    ...query,
  };
}

function startDesktopFrontendLoad(window: BrowserWindow, query: Record<string, string | undefined> = {}): void {
  void loadDesktopFrontend(window, readFrontendSource(), desktopFrontendQuery(query)).catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    if (runtimePaths) {
      appendDesktopLog(runtimePaths.logPath, `frontend load failed ${message}`);
    }
  });
}

async function loadDesktopStartupSurface(window: BrowserWindow): Promise<void> {
  const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Senera</title>
<style>html,body{height:100%;margin:0;background:#0f172a;color:#e2e8f0;font:14px system-ui,sans-serif}main{height:100%;display:grid;place-items:center;letter-spacing:0}span{opacity:.76}</style>
</head><body><main><span>Senera</span></main></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
}

function publishDesktopUpdateState(snapshot: DesktopUpdateSnapshot): void {
  for (const window of [mainWindow, settingsWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send("senera:update.state-changed", snapshot);
  }
}
