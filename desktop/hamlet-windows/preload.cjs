const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hamletDesktop", Object.freeze({
  platform: "windows-desktop",
  version: () => ipcRenderer.invoke("hamlet:version"),
  notify: (payload) => {
    if (!payload || typeof payload !== "object") return Promise.resolve(false);
    const title = typeof payload.title === "string" ? payload.title.slice(0, 100) : "hamlet";
    const body = typeof payload.body === "string" ? payload.body.slice(0, 300) : "";
    return ipcRenderer.invoke("hamlet:notify", { title, body });
  }
}));
