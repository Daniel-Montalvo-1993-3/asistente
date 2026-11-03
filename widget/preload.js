const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro: la interfaz solo puede pedir estas acciones.
contextBridge.exposeInMainWorld('jarvis', {
  quit: () => ipcRenderer.send('quit-app'),
  minimize: () => ipcRenderer.send('minimize-app'),
  openDashboard: () => ipcRenderer.send('open-dashboard')
});
