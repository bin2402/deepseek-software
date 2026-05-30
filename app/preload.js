const { contextBridge, ipcRenderer } = require("electron");

function on(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("deepseekApp", {
  getDataDir: () => ipcRenderer.invoke("app:get-data-dir"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getConversations: () => ipcRenderer.invoke("conversations:get"),
  saveConversations: (data) => ipcRenderer.invoke("conversations:save", data),
  selectAndExtractFiles: () => ipcRenderer.invoke("files:select-and-extract"),
  searchWeb: (query) => ipcRenderer.invoke("search:web", query),
  streamChat: (payload) => ipcRenderer.invoke("chat:stream", payload),
  abortChat: (requestId) => ipcRenderer.invoke("chat:abort", requestId),
  onChatChunk: (callback) => on("chat:chunk", callback),
  onChatDone: (callback) => on("chat:done", callback),
  onChatError: (callback) => on("chat:error", callback),
  onChatAborted: (callback) => on("chat:aborted", callback),
});
