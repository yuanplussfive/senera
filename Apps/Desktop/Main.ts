import path from "node:path";
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
import { parseDesktopReleaseChannel, type DesktopReleaseChannel } from "./DesktopReleaseChannel.js";
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
const settingsSurfaceState: SettingsSurfaceReadinessState = { ready: false };
let desktopTray: Tray | undefined;
let forceSettingsWindowClose = false;
let desktopQuitting = false;
const settingsClosePolicy = new DesktopClosePolicy();
let runtimePaths: DesktopRuntimePaths | undefined;
/** Paths captured once the session reaches readiness; the shutdown marker belongs to that workspace. */
let desktopSessionPaths: DesktopRuntimePaths | undefined;
let frontendSource: DesktopFrontendSource | undefined;
let desktopUpdateService: DesktopUpdateService | undefined;
let pendingUpdateInstall = false;
let desktopStartupReady = false;
let pendingDesktopActivation = false;
const desktopModuleDir = path.dirname(fileURLToPath(import.meta.url));
const desktopProcessStartedAt = Date.now();
/**
 * A crashed renderer is reloaded, but a document that crashes on every load would
 * reload forever. Past this many crashes inside the window the automatic recovery
 * stops and the log stays the only signal.
 */
const DesktopRendererReloadWindowMs = 60_000;
const DesktopRendererReloadLimit = 3;
const rendererReloadTimestamps = new Map<number, number[]>();
const remoteDebuggingPort = process.env.SENERA_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
const desktopReleaseChannel: DesktopReleaseChannel = parseDesktopReleaseChannel(
  process.env.SENERA_DESKTOP_RELEASE_CHANNEL,
);

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
      });
      // The failure is reported where the promise is awaited; this only keeps an
      // early rejection from being treated as unhandled while the window is built.
      serverStartup.catch(() => {});
      desktopTray = createDesktopTray(paths.windowIconPath, () => {
        requestDesktopWorkspaceSelection();
      });
      frontendSource = createDesktopFrontendSource({
        devServerUrl: process.env.SENERA_DESKTOP_FRONTEND_URL,
        documentPath: paths.frontendIndexHtml,
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
      await loadDesktopStartupSurface(mainWindow, paths);
      mainWindow.show();
      const serverStartedAt = Date.now();
      const desktopServer = await serverStartup;
      const serverReadyMs = Date.now() - serverStartedAt;
      serverHandle = desktopServer.currentHandle();
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
  void handle.stop().finally(() => {
    if (sessionPaths) endDesktopSession(sessionPaths);
    app.quit();
  });
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
    },
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(desktopProductTitle("Senera"));
  });
  if (navigationSource) registerNavigationPolicy(window, readFrontendSource());
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
    revealDesktopWindow(settingsWindow);
  });
  settingsWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    settingsWindow?.setTitle(desktopProductTitle(desktopMessage("settings.title", {}, app.getLocale())));
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
function registerDesktopRendererRecovery(window: BrowserWindow, label: "main" | "settings"): void {
  const contents = window.webContents;
  contents.on("render-process-gone", (_event, details) => {
    appendDesktopRecoveryLog(
      `renderer process gone window=${label} reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (desktopQuitting || contents.isDestroyed()) return;
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
