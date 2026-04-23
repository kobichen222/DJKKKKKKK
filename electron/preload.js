/* DJ TITAN — Electron preload bridge
   Exposes a narrow, safe API on window.djtitan so the renderer (sandboxed,
   no node) can receive auto-update lifecycle events from the main process.
   Anything exposed here is the only channel between main and renderer — keep
   the surface small and never pass through ipcRenderer itself. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('djtitan', {
  onUpdateStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => {
      try { callback(payload || {}); } catch (_) { /* isolate renderer errors */ }
    };
    ipcRenderer.on('djtitan:update-status', handler);
    return () => ipcRenderer.removeListener('djtitan:update-status', handler);
  },
  checkForUpdates() {
    ipcRenderer.send('djtitan:check-updates');
  },
});
