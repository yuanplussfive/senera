import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("seneraDesktop", {
  isDesktop: true,
  openSettings: (options?: { section?: string }) => ipcRenderer.invoke("senera:settings.open", options),
  setTitleBarOverlay: (overlay: { color: string; symbolColor: string }) =>
    ipcRenderer.invoke("senera:window.set-title-bar-overlay", overlay),
  setSettingsDirty: (dirty: boolean) => ipcRenderer.invoke("senera:settings.dirty", dirty),
  onSettingsCloseRequested: (listener: () => void) => {
    const handler = (): void => listener();
    ipcRenderer.on("senera:settings.request-close", handler);
    return () => ipcRenderer.removeListener("senera:settings.request-close", handler);
  },
  confirmSettingsClose: () => ipcRenderer.invoke("senera:settings.confirm-close"),
});
