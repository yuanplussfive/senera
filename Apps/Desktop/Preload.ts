import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("seneraDesktop", {
  isDesktop: true,
  openSettings: (options?: { section?: string }) => ipcRenderer.invoke("senera:settings.open", options),
  openExternalUrl: (url: string) => ipcRenderer.invoke("senera:external-url.open", url),
});
