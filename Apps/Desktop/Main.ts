import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { startSeneraServer, type SeneraServerHandle } from "../ServerRuntime.js";
import {
  appendDesktopLog,
  prepareDesktopRuntime,
  type DesktopRuntimePaths,
} from "./DesktopRuntime.js";
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
let runtimePaths: DesktopRuntimePaths | undefined;
let frontendSource: DesktopFrontendSource | undefined;
const desktopModuleDir = path.dirname(fileURLToPath(import.meta.url));

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
  "tools",
  "skills",
  "memory",
  "integrations",
  "usage",
  "about",
]);

app.setName("Senera");
Menu.setApplicationMenu(null);

app.whenReady()
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
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
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
  serverHandle?.stop();
  serverHandle = undefined;
});

function registerDesktopIpc(): void {
  ipcMain.handle("senera:settings.open", (_event, options?: { section?: string }) => {
    openSettingsWindow(options);
  });
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
    void loadDesktopFrontend(settingsWindow, source, {
      surface: "settings",
      section,
    });
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopModuleDir, "Preload.cjs"),
      sandbox: true,
    },
  });

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });
  settingsWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    settingsWindow?.setTitle("Senera 设置");
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
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
