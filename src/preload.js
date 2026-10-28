// Bridges the sandboxed page and the main process. Only these three functions
// are exposed to the page as `window.pipApi`.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pipApi', {
  // true = clicks pass through to whatever is behind the window
  setClickThrough: (through) => ipcRenderer.send('set-click-through', !!through),
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  onCommand: (callback) =>
    ipcRenderer.on('command', (_event, name, data) => callback(name, data)),
});
