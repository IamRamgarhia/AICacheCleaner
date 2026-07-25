const { contextBridge } = require('electron');

// Expose safe IPC APIs to renderer process without giving direct raw Node access
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true
});
