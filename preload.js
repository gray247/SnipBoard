const { contextBridge, ipcRenderer } = require("electron");
const { openColorPicker } = require("./src/ui/colorPicker.js");

contextBridge.exposeInMainWorld("api", {
  invoke: (channel, args) => ipcRenderer.invoke(channel, args),
  send: (channel, args) => {
    const allowedChannels = new Set([
      "get-data",
      "save-clip",
      "delete-clip",
      "create-section",
      "delete-section",
      "save-section-order",
      "list-displays",
      "capture-screen",
      "save-screenshot",
      "get-screenshot-url",
      "open-url",
      "delete-clips",
      "get-clipboard-text",
    ]);
    if (typeof channel !== "string" || !allowedChannels.has(channel)) return;
    ipcRenderer.send(channel, args);
  },
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  getData: () => ipcRenderer.invoke("get-data"),
  listDisplays: () => ipcRenderer.invoke("list-displays"),
  captureScreen: (displayId) =>
    ipcRenderer.invoke("capture-screen", displayId),
  saveScreenshot: (payload) => ipcRenderer.invoke("save-screenshot", payload),
  getScreenshotUrl: (filename) =>
    ipcRenderer.invoke("get-screenshot-url", filename),
  saveClip: (clip, options) => ipcRenderer.invoke("save-clip", clip, options),
  deleteClip: (id) => ipcRenderer.invoke("delete-clip", id),
  deleteClips: (ids) => ipcRenderer.invoke("delete-clips", ids),
  getClipboardText: () => ipcRenderer.invoke("get-clipboard-text"),
  openUrl: (url) => ipcRenderer.invoke("open-url", url),
});

contextBridge.exposeInMainWorld("ui", {
  openColorPicker,
});
