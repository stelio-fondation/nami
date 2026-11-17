// The tab bar's whole bridge: read the tabs, and ask for one of five things.
// Nothing else of Nami's IPC is reachable from this page, and main checks that
// each call comes from a shell's own top frame (workspace-shell.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabsApi', {
  platform: process.platform,
  ready: () => ipcRenderer.invoke('tabs:ready'),
  activate: (id) => ipcRenderer.invoke('tabs:activate', id),
  close: (id) => ipcRenderer.invoke('tabs:close', id),
  newTab: () => ipcRenderer.invoke('tabs:new'),
  move: (id, to) => ipcRenderer.invoke('tabs:move', { id, to }),
  onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('tabs:state', h); return () => ipcRenderer.removeListener('tabs:state', h); },
});
