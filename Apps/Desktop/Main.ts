import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from "electron";
import { startSeneraServer, type SeneraServerHandle } from "../ServerRuntime.js";
import { appendDesktopLog, prepareDesktopRuntime, type DesktopRuntimePaths } from "./DesktopRuntime.js";
import {
  createDesktopFrontendSource,
  loadDesktopFrontend,
  type DesktopFrontendSource,
} from "./DesktopFrontendSource.js";
import { projectDesktopRuntimeConfig } from "./DesktopRuntimeConfig.js";
import { loadConfigFile } from "../../Source/AgentSystem/Config/AgentConfigService.js";

let serverHandle: SeneraServerHandle | undefined;
let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let settingsWindowDirty = false;
let forceSettingsWindowClose = false;
let desktopQuitting = false;
let runtimePaths: DesktopRuntimePaths | undefined;
let frontendSource: DesktopFrontendSource | undefined;
const desktopModuleDir = path.dirname(fileURLToPath(import.meta.url));
const remoteDebuggingPort = process.env.SENERA_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
const mainWindowTitleBarHeight = 52;
const settingsWindowTitleBarHeight = 56;

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
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        void loadDesktopFrontend(mainWindow, readFrontendSource());
      }
    });
  })
  .catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const logPath = runtimePaths?.logPath ?? path.join(app.getPath("userData"), "desktop.log");
    appendDesktopLog(logPath, `startup failed\n${message}`);
    dialog.showErrorBox("Senera 启动失败", message);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  desktopQuitting = true;
  forceSettingsWindowClose = true;
  serverHandle?.stop();
  serverHandle = undefined;
});

function registerDesktopIpc(): void {
  ipcMain.handle("senera:settings.open", (_event, options?: { section?: string }) => {
    openSettingsWindow(options);
  });
  ipcMain.handle("senera:settings.dirty", (event, dirty: boolean) => {
    if (settingsWindow && event.sender === settingsWindow.webContents) {
      settingsWindowDirty = Boolean(dirty);
    }
  });
  ipcMain.handle("senera:settings.confirm-close", (event) => {
    if (!settingsWindow || event.sender !== settingsWindow.webContents) return;
    forceSettingsWindowClose = true;
    settingsWindow.close();
  });
  ipcMain.handle(
    "senera:window.set-title-bar-overlay",
    (event, overlay: { color?: unknown; symbolColor?: unknown }) => {
      if (process.platform === "darwin") return;
      const target = BrowserWindow.fromWebContents(event.sender);
      if (!target || (target !== mainWindow && target !== settingsWindow)) return;
      target.setTitleBarOverlay({
        color: readTitleBarColor(overlay?.color, readInitialTitleBarOverlay().color),
        symbolColor: readTitleBarColor(overlay?.symbolColor, readInitialTitleBarOverlay().symbolColor),
        height: target === settingsWindow ? settingsWindowTitleBarHeight : mainWindowTitleBarHeight,
      });
    },
  );
}

function readInitialTitleBarOverlay(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#242528", symbolColor: "#f5f7fa" }
    : { color: "#ffffff", symbolColor: "#17191c" };
}

function readTitleBarColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function resolveSettingsSection(section: string | undefined): string {
  if (!settingsSectionIds.has(section ?? "")) return "model-service";
  return section as string;
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
    titleBarStyle: "hidden",
    titleBarOverlay: { ...readInitialTitleBarOverlay(), height: mainWindowTitleBarHeight },
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
    if (!settingsWindowDirty) {
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
    titleBarStyle: "hidden",
    titleBarOverlay: { ...readInitialTitleBarOverlay(), height: settingsWindowTitleBarHeight },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopModuleDir, "Preload.cjs"),
      sandbox: true,
    },
  });

  settingsWindowDirty = false;
  forceSettingsWindowClose = false;
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });
  settingsWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    settingsWindow?.setTitle("Senera 设置");
  });
  settingsWindow.on("close", (event) => {
    if (desktopQuitting || forceSettingsWindowClose || !settingsWindowDirty) return;
    event.preventDefault();
    settingsWindow?.webContents.send("senera:settings.request-close");
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    settingsWindowDirty = false;
    forceSettingsWindowClose = false;
  });

  void loadDesktopFrontend(settingsWindow, source, {
    surface: "settings",
    section,
  });
}

function readFrontendSource(): DesktopFrontendSource {
  if (!frontendSource) {
    throw new Error("Desktop frontend source has not been initialized.");
  }
  return frontendSource;
}
