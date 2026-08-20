const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clipIconAPI', {
  translate: () => ipcRenderer.send('clip-icon-clicked'),
});
