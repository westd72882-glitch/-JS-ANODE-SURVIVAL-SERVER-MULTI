const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__DESKTOP', true);
contextBridge.exposeInMainWorld('desktop', {
  setFullscreen: v => ipcRenderer.send('fs-set', !!v),
  onFullscreen: cb => ipcRenderer.on('fs-state', (_, v) => cb(!!v)),
  quit: () => ipcRenderer.send('quit')
});
