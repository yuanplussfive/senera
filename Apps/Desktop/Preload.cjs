const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("seneraDesktop", {
  isDesktop: true,
  openSettings: (options) => ipcRenderer.invoke("senera:settings.open", options),
});
