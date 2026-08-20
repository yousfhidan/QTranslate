const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('popupAPI', {
  onTranslate:  (cb)    => ipcRenderer.on('popup-translate',  (_, t) => cb(t)),
  copyText:     (t)     => ipcRenderer.send('copy-text', t),
  pin:          ()      => ipcRenderer.send('popup-pin'),
  close:        ()      => ipcRenderer.send('popup-close'),
  openMain:     (t)     => ipcRenderer.send('popup-open-main', t),
  resize:       (w, h)  => ipcRenderer.send('popup-resize', w, h),
});

