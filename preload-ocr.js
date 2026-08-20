const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ocrAPI', {
  sendRegion: (region) => ipcRenderer.send('ocr-region-selected', region),
  cancel:     ()       => ipcRenderer.send('ocr-cancel'),
  onHideUI:   (cb)     => ipcRenderer.on('ocr-hide-ui', () => cb()),
});
