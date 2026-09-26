const { contextBridge, ipcRenderer } = require('electron');

// The only native capabilities the renderer gets — fixed shapes, no raw Node.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  // 'mica' when the window paints Windows 11's material behind the page.
  material: process.argv.includes('--aicc-material=mica') ? 'mica' : null,
  fileIcon: (p) => ipcRenderer.invoke('app:fileIcon', p),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),
  alert: (opts) => ipcRenderer.invoke('dialog:alert', opts),
  pickFolder: (opts) => ipcRenderer.invoke('dialog:pickFolder', opts),
  contextMenu: (items) => ipcRenderer.invoke('menu:context', items),
  downloadUpdate: (asset, onProgress) => {
    const listener = (_e, p) => onProgress?.(p);
    ipcRenderer.on('update:progress', listener);
    return ipcRenderer.invoke('update:download', asset)
      .finally(() => ipcRenderer.removeListener('update:progress', listener));
  },
  onCommand: (handler) => {
    const listener = (_e, cmd) => handler(String(cmd));
    ipcRenderer.on('app:command', listener);
    return () => ipcRenderer.removeListener('app:command', listener);
  }
});
