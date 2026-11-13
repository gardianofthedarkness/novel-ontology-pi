// The window's only way to the Mac: the libraries, the novel server's requests (a fixed list, checked again in main.js), the
// keys' state and entry (a key goes in, never comes out), and showing a folder in Finder.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novelHost", {
  platform: process.platform,
  libraries: () => ipcRenderer.invoke("libraries"),
  addLibrary: (folder) => ipcRenderer.invoke("addLibrary", folder),
  removeLibrary: (folder) => ipcRenderer.invoke("removeLibrary", folder),
  importText: (folder) => ipcRenderer.invoke("importText", folder),
  arrangeWithAgent: (folder, options) => ipcRenderer.invoke("arrangeWithAgent", folder, options),
  agentSetup: (apply) => ipcRenderer.invoke("agentSetup", apply),
  onAgentStep: (listener) => { ipcRenderer.on("agentStep", (event, step) => listener(step)); },
  ask: (folder, method, params) => ipcRenderer.invoke("ask", folder, method, params),
  keys: () => ipcRenderer.invoke("keys"),
  setKeys: (keys) => ipcRenderer.invoke("setKeys", keys),
  reveal: (folder) => ipcRenderer.invoke("reveal", folder),
  version: () => ipcRenderer.invoke("version"),
  agents: () => ipcRenderer.invoke("agents"),
  worlds: (folder) => ipcRenderer.invoke("worlds", folder),
  copyWorld: (folder, root) => ipcRenderer.invoke("copyWorld", folder, root),
  worldReview: (wid, volume) => ipcRenderer.invoke("worldReview", wid, volume),
  worldReviewStep: (wid, volume, step) => ipcRenderer.invoke("worldReviewStep", wid, volume, step),
  answerReviewWithAgent: (wid, volume, options) => ipcRenderer.invoke("answerReviewWithAgent", wid, volume, options),
  volumeStatus: (wid, volume) => ipcRenderer.invoke("volumeStatus", wid, volume),
  runVolume: (wid, volume, options) => ipcRenderer.invoke("runVolume", wid, volume, options),
  transcript: (key) => ipcRenderer.invoke("transcript", key),
  sendToSession: (key, text) => ipcRenderer.invoke("sendToSession", key, text),
});
