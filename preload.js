const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  copyText: (t) => ipcRenderer.send('copy-text', t),
  // Translation
  onTranslateClipboard: (cb) => ipcRenderer.on('translate-clipboard', (_, t) => cb(t)),
  onOcrImageData: (cb) => ipcRenderer.on('ocr-image-data', (_, d) => cb(d)),
  // Settings modal triggers
  onOpenHotkeysSettings: (cb) => ipcRenderer.on('open-hotkeys-settings', () => cb()),
  // Actions
  openOcrWindow: () => ipcRenderer.send('open-ocr-window'),
  pauseHotkeys: () => ipcRenderer.send('pause-hotkeys'),
  resumeHotkeys: () => ipcRenderer.send('resume-hotkeys'),
  // Hotkeys CRUD
  getHotkeys: () => ipcRenderer.invoke('get-hotkeys'),
  updateHotkeys: (hk) => ipcRenderer.send('update-hotkeys', hk),
  resetHotkeys: () => ipcRenderer.send('reset-hotkeys'),
  onHotkeysUpdated: (cb) => ipcRenderer.on('hotkeys-updated', (_, hk, results) => cb(hk, results)),
});
