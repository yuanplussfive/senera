const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("seneraDesktop", {
  isDesktop: true,
  windowControls: process.platform === "darwin" ? "native" : "custom",
  openSettings: (options) => ipcRenderer.invoke("senera:settings.open", options),
  minimizeWindow: () => ipcRenderer.invoke("senera:window.minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("senera:window.toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("senera:window.close"),
  getWindowState: () => ipcRenderer.invoke("senera:window.get-state"),
  onWindowStateChanged: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("senera:window.state-changed", handler);
    return () => ipcRenderer.removeListener("senera:window.state-changed", handler);
  },
  setSettingsDirty: (dirty) => ipcRenderer.invoke("senera:settings.dirty", dirty),
  onSettingsCloseRequested: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("senera:settings.request-close", handler);
    return () => ipcRenderer.removeListener("senera:settings.request-close", handler);
  },
  confirmSettingsClose: () => ipcRenderer.invoke("senera:settings.confirm-close"),
});
