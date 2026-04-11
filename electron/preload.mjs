import { contextBridge, ipcRenderer } from "electron";

const WINDOW_STATE_CHANNEL = "window:state-changed";

contextBridge.exposeInMainWorld("relyycastDesktop", {
  shell: "desktop-window",
});

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  onWindowStateChange: (listener) => {
    const handler = (_event, payload) => {
      listener(payload);
    };

    ipcRenderer.on(WINDOW_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(WINDOW_STATE_CHANNEL, handler);
    };
  },
});
