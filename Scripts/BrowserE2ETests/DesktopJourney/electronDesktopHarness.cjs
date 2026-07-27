const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const httpOrigin = readLoopbackOrigin(process.env.SENERA_BROWSER_E2E_HTTP_ORIGIN);
const userDataRoot = process.env.SENERA_BROWSER_E2E_USER_DATA_ROOT;
if (!userDataRoot) throw new Error("SENERA_BROWSER_E2E_USER_DATA_ROOT is required.");

app.disableHardwareAcceleration();
app.setPath("userData", path.resolve(userDataRoot));
app.commandLine.appendSwitch("lang", "zh-CN");
registerDesktopIpc();

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 960,
      height: 680,
      minWidth: 820,
      minHeight: 560,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, "..", "..", "..", "Apps", "Desktop", "Preload.cjs"),
        sandbox: true,
      },
    });
    const target = new URL("/settings/appearance", httpOrigin);
    target.searchParams.set("surface", "settings");
    target.searchParams.set("section", "appearance");
    await window.loadURL(target.toString());
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    app.exit(1);
  });

app.on("window-all-closed", () => app.quit());

function registerDesktopIpc() {
  ipcMain.handle("senera:settings.open", () => undefined);
  ipcMain.handle("senera:settings.dirty", () => undefined);
  ipcMain.handle("senera:settings.confirm-close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("senera:settings.cancel-close", () => undefined);
  ipcMain.handle("senera:window.minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("senera:window.toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return undefined;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return { isMaximized: window.isMaximized() };
  });
  ipcMain.handle("senera:window.close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("senera:window.get-state", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? { isMaximized: window.isMaximized() } : undefined;
  });
  ipcMain.handle("senera:external-url.open", () => undefined);
}

function readLoopbackOrigin(value) {
  const origin = new URL(value ?? "");
  if (origin.protocol !== "http:" || (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost")) {
    throw new Error("SENERA_BROWSER_E2E_HTTP_ORIGIN must be an HTTP loopback origin.");
  }
  return origin;
}
