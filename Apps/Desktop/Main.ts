import path from "node:path";
import electron from "electron";
import { startSeneraServer, type SeneraServerHandle } from "../ServerRuntime.js";
import {
  appendDesktopLog,
  prepareDesktopRuntime,
  type DesktopRuntimePaths,
} from "./DesktopRuntime.js";
import { projectDesktopRuntimeConfig } from "./DesktopRuntimeConfig.js";
import { loadConfigFile } from "../../Source/AgentSystem/Config/AgentConfigService.js";

const { app, BrowserWindow, dialog, Menu } = electron;

let serverHandle: SeneraServerHandle | undefined;
let mainWindow: electron.BrowserWindow | undefined;
let runtimePaths: DesktopRuntimePaths | undefined;

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
      resourcesPath: paths.appRoot,
    });
    mainWindow = createMainWindow();
    void mainWindow.loadFile(runtimePaths.frontendIndexHtml);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        void mainWindow.loadFile(runtimePaths?.frontendIndexHtml ?? "");
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

function createMainWindow(): electron.BrowserWindow {
  return new BrowserWindow({
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
      sandbox: true,
    },
  });
}
