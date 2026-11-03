import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import {
  appendDesktopLog,
  beginDesktopSession,
  chooseDesktopWorkspace,
  endDesktopSession,
  persistDesktopWorkspace,
  prepareDesktopRuntime,
  readDesktopSessionCrashed,
  type DesktopRuntimePaths,
} from "./DesktopRuntime.js";
import { installAgentProcessFailureGuard } from "../../Source/AgentSystem/Diagnostics/AgentProcessGuard.js";
import {
  createDesktopFrontendSource,
  loadDesktopFrontend,
  type DesktopFrontendSource,
} from "./DesktopFrontendSource.js";
import { DesktopServerHost, type DesktopServerHandle } from "./DesktopServerHost.js";
import { isTrustedDesktopNavigation } from "./DesktopNavigationPolicy.js";
import { DesktopClosePolicy, type DesktopCloseIntent } from "./DesktopClosePolicy.js";
import {
  invalidateSettingsSurfaceForReload,
  markSettingsSurfaceReady,
  queueSettingsSection,
  type SettingsSurfaceDeliveryOptions,
  type SettingsSurfaceReadinessState,
} from "./DesktopSettingsHandshake.js";
import { hideDesktopWindows, revealDesktopWindow, showDesktopWindows } from "./DesktopWindowVisibility.js";
import { parseDesktopReleaseChannel } from "./DesktopReleaseChannel.js";
import { resolveDesktopChannelClientUrl } from "./DesktopChannelClientUrl.js";
import { desktopMessage, resolveDesktopLocale } from "./DesktopMessageCatalog.js";
import {
  readDesktopStartupCanvasColor,
  resolveDesktopStartupTheme,
  type DesktopStartupTheme,
} from "./DesktopStartupSurface.js";
import {
  DesktopExternalUrlPolicy,
  resolveAgentExternalUrl,
} from "../../Source/AgentSystem/Interaction/AgentExternalUrlPolicy.js";
import { openDesktopExternalFile, readDesktopExternalOpenRequest } from "./DesktopExternalOpen.js";
import { DesktopUpdateService } from "./DesktopUpdateService.js";
import type { DesktopUpdateSnapshot } from "./DesktopUpdateProtocol.js";
import { DesktopHostIntegrationService, spawnDesktopProcessDetached } from "./DesktopHostIntegrationService.js";
import { desktopHostIntegrationFailure } from "./DesktopHostIntegrationProtocol.js";
import { readAgentProductMetadata } from "../../Source/AgentSystem/Core/AgentProductMetadata.js";
import { resolveAgentWorkspaceConfigPath } from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import {
  isAgentSettingsSectionId,
  type AgentSettingsSectionId,
} from "../../Source/AgentSystem/Settings/AgentSettingsSectionContract.js";

let serverHandle: DesktopServerHandle | undefined;
let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
const channelClientWindows = new Map<string, BrowserWindow>();
let settingsWindowReady = false;
const settingsSurfaceState: SettingsSurfaceReadinessState = { ready: false };
let desktopTray: Tray | undefined;
let forceSettingsWindowClose = false;
let desktopQuitting = false;
const settingsClosePolicy = new DesktopClosePolicy();
let runtimePaths: DesktopRuntimePaths | undefined;
let desktopSessionPaths: DesktopRuntimePaths | undefined;
let frontendSource: DesktopFrontendSource | undefined;
let desktopUpdateService: DesktopUpdateService | undefined;
let desktopHostIntegrations: DesktopHostIntegrationService | undefined;
let pendingUpdateInstall = false;
let desktopStartupReady = false;
let pendingDesktopActivation = false;
const desktopModuleDir = path.dirname(fileURLToPath(import.meta.url));
const desktopProcessStartedAt = Date.now();
const DesktopRendererReloadWindowMs = 60_000;
const DesktopRendererReloadLimit = 3;
const rendererReloadTimestamps = new Map<number, number[]>();
const desktopReleaseChannel = parseDesktopReleaseChannel(process.env.SENERA_DESKTOP_RELEASE_CHANNEL);
const remoteDebuggingPort = process.env.SENERA_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();

app.setName("Senera");
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}
Menu.setApplicationMenu(null);

// Crash reports stay local: the desktop app has no upload endpoint, and a dump is
// only useful next to the desktop.log the user can already reach.
crashReporter.start({ productName: "Senera", uploadToServer: false, compress: true });

// Desktop main has no supervisor, so an uncaught exception has to reach the log and
// stop the workspace before the process dies.
installAgentProcessFailureGuard({
  logger: {
    error: (message, details = {}) => appendDesktopGuardLog("error", message, details),
    warn: (message, details = {}) => appendDesktopGuardLog("warn", message, details),
  },
  onFatalShutdown: async () => {
    const handle = serverHandle;
    serverHandle = undefined;
    await handle?.stop();
  },
});

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
      if (readDesktopSessionCrashed(paths)) {
        appendDesktopLog(paths.logPath, "previous desktop session did not shut down cleanly");
      }
      appendDesktopLog(paths.logPath, `crash dumps directory: ${app.getPath("crashDumps")}`);
      // The utility process spends most of its startup loading its module graph,
      // so it starts before the tray and window work instead of after the startup
      // surface is already on screen; the window still waits for it below.
      const serverStartedAt = Date.now();
      const serverStartup = DesktopServerHost.start({
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
      }).then(
        (host) => ({ ok: true as const, host }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      desktopTray = createDesktopTray(paths.windowIconPath, requestDesktopWorkspaceSelection);
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
      await loadDesktopStartupSurface(mainWindow, paths);
      mainWindow.show();
      const started = await serverStartup;
      if (!started.ok) throw started.error;
      const serverReadyMs = Date.now() - serverStartedAt;
      serverHandle = started.host.currentHandle();
      frontendSource = createDesktopFrontendSource({
        devServerUrl: process.env.SENERA_DESKTOP_FRONTEND_URL,
        serverUrl: serverHandle.healthUrl,
        documentPath: paths.frontendIndexHtml,
      });
      desktopHostIntegrations = new DesktopHostIntegrationService({
        resolveWorkspaceRoot: () => serverHandle?.workspaceRoot ?? runtimePaths?.workspaceRoot,
        effects: {
          openPath: (target) => shell.openPath(target),
          spawnDetached: spawnDesktopProcessDetached,
        },
      });
      registerNavigationPolicy(mainWindow, frontendSource);
      const frontendStartedAt = Date.now();
      await loadDesktopFrontend(mainWindow, frontendSource, desktopFrontendQuery());
      appendDesktopLog(
        paths.logPath,
        `desktop ready in ${Date.now() - desktopProcessStartedAt}ms server=${serverReadyMs}ms frontend=${Date.now() - frontendStartedAt}ms`,
      );
      desktopStartupReady = true;
      desktopSessionPaths = paths;
      beginDesktopSession(paths);
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
  const sessionPaths = desktopSessionPaths;
  desktopSessionPaths = undefined;
  if (!handle) {
    // Removing the marker is what makes the next start treat this run as clean.
    if (sessionPaths) endDesktopSession(sessionPaths);
    return;
  }
  event.preventDefault();
  void handle.stop().then(
    () => {
      if (sessionPaths) endDesktopSession(sessionPaths);
      app.quit();
    },
    (error: unknown) => {
      appendDesktopRecoveryLog(`desktop shutdown failed: ${String(error)}`);
      app.exit(1);
    },
  );
});

// The server runs in a utility process. If it dies the window keeps its last paint, so
// the log is the only place that says why the workspace stopped answering.
app.on("child-process-gone", (_event, details) => {
  appendDesktopRecoveryLog(
    `child process gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} service=${details.serviceName ?? ""}`,
  );
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
    markSettingsSurfaceReady(settingsSurfaceState, readSettingsSurfaceDeliveryOptions());
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
  ipcMain.handle("senera:file.open-external", async (event, payload: unknown) => {
    if (!resolveManagedWindow(event)) return { ok: false, code: "blocked" } as const;
    const request = readDesktopExternalOpenRequest(payload);
    if (!request) return { ok: false, code: "invalid-payload" } as const;
    return openDesktopExternalFile(request, {
      tempRoot: path.join(app.getPath("temp"), "senera-opened-files"),
      writeFile: async (filePath, bytes) => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, bytes);
      },
      openPath: (filePath) => shell.openPath(filePath),
    });
  });
  ipcMain.handle("senera:workspace.choose-folder", async (event) => {
    if (!resolveManagedWindow(event)) return null;
    return (await chooseDesktopWorkspace()) ?? null;
  });
  ipcMain.handle("senera:host.capabilities", (event) => {
    if (!resolveManagedWindow(event)) return undefined;
    return desktopHostIntegrations?.getCapabilities();
  });
  ipcMain.handle("senera:host.reveal-workspace", async (event) => {
    if (!resolveManagedWindow(event) || !desktopHostIntegrations) return desktopHostIntegrationFailure("unavailable");
    return desktopHostIntegrations.revealWorkspace();
  });
  ipcMain.handle("senera:host.open-terminal", async (event) => {
    if (!resolveManagedWindow(event) || !desktopHostIntegrations) return desktopHostIntegrationFailure("unavailable");
    return desktopHostIntegrations.openExternalTerminal();
  });
  ipcMain.handle("senera:qq-client.open", async (event, workspaceId: string): Promise<{ ok: boolean }> => {
    if (!resolveManagedWindow(event)) return { ok: false };
    return openQqClientWindow(workspaceId);
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
  tray.setToolTip(desktopProductTitle("Senera"));
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
    backgroundColor: readDesktopStartupCanvasColor(readDesktopStartupTheme()),
    title: desktopProductTitle("Senera"),
    icon: runtimePaths?.windowIconPath,
    show: false,
    autoHideMenuBar: true,
    ...readWindowFrameOptions(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopModuleDir, "Preload.cjs"),
      sandbox: true,
      webviewTag: true,
    },
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(desktopProductTitle("Senera"));
  });
  if (navigationSource) registerNavigationPolicy(window, readFrontendSource());
  registerWorkspaceWebviewPolicy(window);
  registerWindowStateEvents(window);
  registerDesktopRendererRecovery(window, "main");
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

async function openQqClientWindow(workspaceId: string): Promise<{ ok: boolean }> {
  if (!runtimePaths || !serverHandle) return { ok: false };
  const url = resolveDesktopChannelClientUrl(readFrontendSource(), serverHandle.websocketUrl, workspaceId);
  const existing = channelClientWindows.get(workspaceId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true };
  }
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 390,
    minHeight: 560,
    title: "Senera QQ",
    backgroundColor: "#f7f8f6",
    icon: runtimePaths.windowIconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  channelClientWindows.set(workspaceId, window);
  registerDesktopRendererRecovery(window, "qq");
  let consolePath: string | undefined;
  window.webContents.on("did-finish-load", () => {
    consolePath = undefined;
    const documentUrl = window.webContents.getURL();
    if (!isTrustedDesktopNavigation(documentUrl, { kind: "url", url })) return;
    void window.webContents
      .executeJavaScript("document.querySelector('meta[name=\"senera-console-path\"]')?.content")
      .then((value: unknown) => {
        if (window.isDestroyed() || window.webContents.getURL() !== documentUrl) return;
        if (typeof value === "string" && value.startsWith("/")) consolePath = value;
      })
      .catch((error: unknown) => {
        if (runtimePaths)
          appendDesktopLog(runtimePaths.logPath, `QQ console navigation metadata failed: ${String(error)}`);
      });
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (!consolePath || !isTrustedDesktopNavigation(target, { kind: "url", url })) return;
    if (new URL(target).pathname !== consolePath) return;
    event.preventDefault();
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      startDesktopFrontendLoad(mainWindow);
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  registerNavigationPolicy(window, { kind: "url", url });
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => channelClientWindows.delete(workspaceId));
  try {
    await window.loadURL(url);
    return { ok: true };
  } catch (error) {
    appendDesktopLog(runtimePaths.logPath, `QQ client load failed: ${String(error)}`);
    window.destroy();
    return { ok: false };
  }
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
    // Reopening the entry point on an already open window must raise it: the
    // request is explicit, so a visible-but-covered window still needs focus.
    if (settingsWindowReady) revealDesktopWindow(settingsWindow);
    if (!settingsClosePolicy.dirty) requestSettingsSectionNavigation(section);
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 620,
    backgroundColor: readDesktopStartupCanvasColor(readDesktopStartupTheme()),
    title: desktopProductTitle(desktopMessage("settings.title", {}, app.getLocale())),
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
  settingsSurfaceState.ready = false;
  settingsSurfaceState.pendingSection = section;
  settingsWindow.once("ready-to-show", () => {
    settingsWindowReady = true;
    presentSettingsWindow({ focus: true });
  });
  settingsWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    settingsWindow?.setTitle(desktopMessage("settings.title", {}, app.getLocale()));
  });
  settingsWindow.webContents.on("did-start-loading", () => {
    // The fresh document has not registered its section listener yet and the
    // renderer that reported dirty state is gone, so neither may survive.
    invalidateSettingsSurfaceForReload(settingsSurfaceState);
    settingsClosePolicy.reset();
  });
  registerWindowStateEvents(settingsWindow);
  registerDesktopRendererRecovery(settingsWindow, "settings");
  registerNavigationPolicy(settingsWindow, source);
  settingsWindow.on("close", (event) => {
    if (forceSettingsWindowClose || !settingsClosePolicy.dirty) return;
    event.preventDefault();
    requestDirtySettingsConfirmation("settings");
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    settingsWindowReady = false;
    settingsSurfaceState.ready = false;
    settingsSurfaceState.pendingSection = undefined;
    settingsClosePolicy.reset();
    forceSettingsWindowClose = false;
  });

  startDesktopFrontendLoad(settingsWindow, {
    surface: "settings",
    section,
  });
}

function requestSettingsSectionNavigation(section: AgentSettingsSectionId): void {
  queueSettingsSection(settingsSurfaceState, section, readSettingsSurfaceDeliveryOptions());
}

function readSettingsSurfaceDeliveryOptions(): SettingsSurfaceDeliveryOptions {
  const window = settingsWindow;
  return {
    dirty: settingsClosePolicy.dirty,
    destroyed: !window || window.isDestroyed() || window.webContents.isDestroyed(),
    sendSection: (section) => window?.webContents.send("senera:settings.navigate", section),
  };
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
  if (event.senderFrame !== event.sender.mainFrame) return undefined;
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
  revealDesktopWindow(settingsWindow);
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

/** Hardens every workspace browser guest attached by the renderer's `webview` tags. */
function registerWorkspaceWebviewPolicy(window: BrowserWindow): void {
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!readHttpUrl(params.src)) event.preventDefault();
  });
  window.webContents.on("did-attach-webview", (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      openExternalHttpUrl(url);
      return { action: "deny" };
    });
    guest.on("will-navigate", (event, url) => {
      if (readHttpUrl(url)) return;
      event.preventDefault();
      openExternalHttpUrl(url);
    });
  });
}

function readHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
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
    releaseChannel: desktopReleaseChannel === "development" ? "development" : undefined,
    ...query,
  };
}

function desktopProductTitle(title: string): string {
  if (desktopReleaseChannel !== "development") return title;
  return desktopMessage("product.title.development", { title }, app.getLocale());
}

function startDesktopFrontendLoad(window: BrowserWindow, query: Record<string, string | undefined> = {}): void {
  void loadDesktopFrontend(window, readFrontendSource(), desktopFrontendQuery(query)).catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    if (runtimePaths) {
      appendDesktopLog(runtimePaths.logPath, `frontend load failed ${message}`);
    }
  });
}

/**
 * The startup surface is a frontend asset, so it resolves through the same
 * source as the app itself: the dev server while it runs, the built file
 * otherwise. A missing file must not stop the launch — the window already
 * carries the canvas color, and the app loads right after.
 */
async function loadDesktopStartupSurface(window: BrowserWindow, paths: DesktopRuntimePaths): Promise<void> {
  const locale = app.getLocale();
  const source = createDesktopFrontendSource({
    devServerUrl: process.env.SENERA_DESKTOP_FRONTEND_URL,
    documentPath: paths.startupSurfaceHtml,
    devServerPath: "/startup.html",
  });
  try {
    await loadDesktopFrontend(window, source, {
      title: desktopProductTitle("Senera"),
      status: desktopMessage("startup.loading", {}, locale),
      locale: resolveDesktopLocale(locale),
    });
  } catch (error) {
    appendDesktopLog(paths.logPath, `startup surface failed\n${String(error)}`);
  }
}

/** Both windows and the startup surface share the appearance the OS reports. */
function readDesktopStartupTheme(): DesktopStartupTheme {
  return resolveDesktopStartupTheme(nativeTheme.shouldUseDarkColors);
}

function publishDesktopUpdateState(snapshot: DesktopUpdateSnapshot): void {
  for (const window of [mainWindow, settingsWindow]) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send("senera:update.state-changed", snapshot);
  }
}

/**
 * Renderer crashes are recovered in place. The document reloads from the URL it was
 * loaded from, so the settings section and the workspace websocket URL survive. The
 * desktop stays resident in the tray, so without this a crashed window would remain
 * blank until the user restarted the app.
 */
function registerDesktopRendererRecovery(window: BrowserWindow, label: "main" | "settings" | "qq"): void {
  const contents = window.webContents;
  contents.on("render-process-gone", (_event, details) => {
    appendDesktopRecoveryLog(
      `renderer process gone window=${label} reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (desktopQuitting || contents.isDestroyed() || details.reason === "clean-exit") return;
    const now = Date.now();
    const recent = (rendererReloadTimestamps.get(contents.id) ?? []).filter(
      (at) => now - at < DesktopRendererReloadWindowMs,
    );
    if (recent.length >= DesktopRendererReloadLimit) {
      rendererReloadTimestamps.set(contents.id, recent);
      appendDesktopRecoveryLog(`renderer crash loop detected window=${label}; automatic reload stopped`);
      return;
    }
    rendererReloadTimestamps.set(contents.id, [...recent, now]);
    appendDesktopRecoveryLog(`reloading renderer window=${label}`);
    contents.once("did-finish-load", () => {
      appendDesktopRecoveryLog(`renderer reload completed window=${label}`);
    });
    contents.reload();
  });
  contents.on("unresponsive", () => {
    appendDesktopRecoveryLog(`renderer unresponsive window=${label}`);
  });
  contents.on("destroyed", () => {
    rendererReloadTimestamps.delete(contents.id);
  });
}

function appendDesktopRecoveryLog(message: string): void {
  if (!runtimePaths) return;
  appendDesktopLog(runtimePaths.logPath, message);
}

/** The guard runs before the runtime paths exist, so it falls back to Electron's user data. */
function appendDesktopGuardLog(level: "error" | "warn", message: string, details: Record<string, unknown> = {}): void {
  const logPath = runtimePaths?.logPath ?? path.join(app.getPath("userData"), "desktop.log");
  appendDesktopLog(logPath, `[${level}] ${message} ${JSON.stringify(details)}`);
}
