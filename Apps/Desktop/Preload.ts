import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("seneraDesktop", {
  isDesktop: true,
  windowControls: process.platform === "darwin" ? "native" : "custom",
  openSettings: (options?: { section?: string }) => ipcRenderer.invoke("senera:settings.open", options),
  minimizeWindow: () => ipcRenderer.invoke("senera:window.minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("senera:window.toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("senera:window.close"),
  getWindowState: () => ipcRenderer.invoke("senera:window.get-state"),
  onWindowStateChanged: (listener: (state: { isMaximized: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { isMaximized: boolean }): void => listener(state);
    ipcRenderer.on("senera:window.state-changed", handler);
    return () => ipcRenderer.removeListener("senera:window.state-changed", handler);
  },
  setSettingsDirty: (dirty: boolean) => ipcRenderer.invoke("senera:settings.dirty", dirty),
  onSettingsCloseRequested: (listener: () => void) => {
    const handler = (): void => listener();
    ipcRenderer.on("senera:settings.request-close", handler);
    return () => ipcRenderer.removeListener("senera:settings.request-close", handler);
  },
  confirmSettingsClose: () => ipcRenderer.invoke("senera:settings.confirm-close"),
});
