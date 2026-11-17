// The tabbed window: one shell, a tab bar, and a whole Nami per tab.
//
// The shell is a BrowserWindow whose own page is the tab bar (tabbar.html).
// Each tab is a plain View, placed under the bar, holding a WebContentsView
// that loads the same index.html a classic window does — app.js still sees one
// folder and never learns tabs exist. Everything that belongs to that tab is a
// child of its View: the page, and the browser panes and overlays the browser
// modules attach. Their bounds are therefore the tab's own coordinates, as they
// always were, and hiding the View hides the whole tab. A hidden tab is not
// unloaded: its sessions keep running and keep writing to their terminals.
//
// A tab is handed to main.js as a *host* (window-host.js): it carries the
// webContents, contentView and window events a BrowserWindow would, so main's
// per-window bookkeeping (wins, winFolders, sessionOwners, the browser modules)
// takes it unchanged.

const { EventEmitter } = require('node:events');
const { createTabModel, tabsFromRecord, windowRecord, tabLabel } = require('./workspace-tabs');
const { tabKeyAction } = require('./tab-keys');

// Tall enough for a tab you can hit and for the Windows caption buttons, which
// the shell asks the system to draw at this height so they sit in the bar.
const BAR_HEIGHT = 36;
// The renderer's own deck for the traffic lights / caption buttons. The bar
// holds them now, so a tab drawing the deck too would leave an empty strip.
const TAB_CSS = '.lights-deck{display:none!important}';

class TabHost extends EventEmitter {
  constructor(shell, tab, container, view) {
    super();
    this.shell = shell;
    this.tab = tab;
    this.container = container;
    this.view = view;
    this.destroyed = false;
  }
  get webContents() { return this.view.webContents; }
  get contentView() { return this.container; }
  get window() { return this.shell.window; }
  get offset() { return { x: 0, y: this.shell.barHeight }; }
  get tabId() { return this.tab.id; }
  isDestroyed() { return this.destroyed || this.view.webContents.isDestroyed(); }
  // Only the size is read (browser-overlays.js clamps to it): the tab's area.
  getContentBounds() { const b = this.container.getBounds(); return { x: 0, y: 0, width: b.width, height: b.height }; }
  getNormalBounds() { return this.window.getNormalBounds(); }
  isMinimized() { return this.window.isMinimized(); }
  restore() { this.window.restore(); }
  focus() { this.shell.api.activate(this); this.window.focus(); }
  close() { return this.shell.api.closeTab(this, { confirmed: true }); }
}

// An event a listener may cancel, shaped like Electron's for 'close'.
function cancellable() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

function createWorkspaceShells({
  electron,                 // { BrowserWindow, View, WebContentsView, dialog, ipcMain }
  files,                    // { tabbarHtml, tabbarPreload, appPreload }
  chrome,                   // (shell?) => windowChrome(...) for the window's theme
  background,               // (shell?) => background colour for it
  theme,                    // (shell?) => its theme name
  harden,                   // (webContents) => lockNavigation
  setupTab,                 // (host, folder) => main's per-renderer setup; loads the page
  liveSessions = () => 0,   // (host) => how many sessions would end with it
  deskEmpty = () => false,  // (host) => whether ⌘W should close the tab
  sendCommand = () => {},   // (host, command) => menu:command to a tab
  onChange = () => {},      // a tab opened, closed, moved, was activated or relabelled
  onBounds = () => {},      // the window moved or was resized
  onWindowClose = () => {}, // (record) => the window is going; its record, for window-memory
  platform = process.platform,
  newWindowBounds = null,   // () => bounds for a window that is not restoring any
}) {
  const { BrowserWindow, View, WebContentsView, dialog, ipcMain } = electron;
  const shells = new Set();
  const byWindow = new Map();
  const byShellWc = new Map();
  let lastFocused = null;

  // The window's chrome, with the system's parts moved into the bar.
  function shellChrome(shell) {
    const c = { ...chrome(shell) };
    if (c.titleBarOverlay) c.titleBarOverlay = { ...c.titleBarOverlay, height: BAR_HEIGHT };
    if (c.trafficLightPosition) c.trafficLightPosition = { x: 14, y: Math.round((BAR_HEIGHT - 14) / 2) };
    return c;
  }

  function createWindow({ bounds, tabs, active } = {}) {
    const restoring = tabsFromRecord({ tabs: Array.isArray(tabs) && tabs.length ? tabs : [{ folder: null }], active }, platform);
    const size = bounds && Number.isFinite(bounds.width) ? bounds : (newWindowBounds && newWindowBounds()) || {};
    const w = new BrowserWindow({
      width: 1360, height: 940, minWidth: 560, minHeight: 480,
      ...size,
      ...shellChrome(null),
      backgroundColor: background(null),
      webPreferences: { preload: files.tabbarPreload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const shell = { window: w, model: createTabModel({ platform }), hosts: new Map(), barHeight: BAR_HEIGHT, fullscreen: false, closeApproved: false, lastState: '' };
    shell.api = api;
    const shellWcId = w.webContents.id;
    shells.add(shell); byWindow.set(w, shell); byShellWc.set(shellWcId, shell);
    lastFocused = shell;
    harden(w.webContents);
    w.webContents.on('before-input-event', (event, input) => onKey(shell, null, event, input));
    w.loadFile(files.tabbarHtml);

    for (const t of restoring.tabs) openTab(shell, t.folder, { activate: false, quiet: true });
    const first = shell.model.tabs[restoring.active];
    if (first) shell.model.activate(first.id);
    show(shell);

    w.on('resize', () => { layout(shell); onBounds(shell); });
    w.on('move', () => onBounds(shell));
    w.on('focus', () => {
      lastFocused = shell;
      const host = activeHost(shell);
      if (host) { host.webContents.focus(); host.emit('focus'); }
    });
    w.on('enter-full-screen', () => { shell.fullscreen = true; pushState(shell, true); });
    w.on('leave-full-screen', () => { shell.fullscreen = false; pushState(shell, true); });
    w.on('close', (event) => {
      if (shell.closeApproved) return;
      // A tab can hold the window open (pending browser annotations): ask each.
      for (const host of shell.hosts.values()) {
        const ev = cancellable();
        host.emit('close', ev);
        if (ev.defaultPrevented) { event.preventDefault(); return; }
      }
      // Read now: by 'closed' the bounds are gone, and off a Mac the last
      // window closing is the quit window-memory.js has to remember.
      onWindowClose(record(shell));
    });
    w.on('closed', () => {
      for (const host of [...shell.hosts.values()]) destroyTab(shell, host, { quiet: true });
      shells.delete(shell); byWindow.delete(w); byShellWc.delete(shellWcId);
      if (lastFocused === shell) lastFocused = [...shells].pop() || null;
      onChange(null);
    });
    onChange(shell);
    return shell;
  }

  function openTab(shell, folder, { activate: front = true, quiet = false } = {}) {
    const { tab, existed, full } = shell.model.add(folder, { activate: front, after: front ? shell.model.activeId : null });
    if (full) return { host: activeHost(shell), existed: false, full: true };
    if (existed) {
      if (front) show(shell);
      return { host: shell.hosts.get(tab.id), existed: true };
    }
    const container = new View();
    const view = new WebContentsView({
      webPreferences: { preload: files.appPreload, contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true, additionalArguments: ['--nami-tabs'] },
    });
    view.setBackgroundColor(background(shell));
    container.addChildView(view);
    shell.window.contentView.addChildView(container);
    container.setVisible(false);
    const host = new TabHost(shell, tab, container, view);
    shell.hosts.set(tab.id, host);
    view.webContents.on('dom-ready', () => { view.webContents.insertCSS(TAB_CSS).catch(() => {}); });
    view.webContents.on('before-input-event', (event, input) => onKey(shell, host, event, input));
    layout(shell);
    setupTab(host, tab.folder);
    if (!quiet) { show(shell); onChange(shell); }
    return { host, existed: false };
  }

  function layout(shell) {
    if (shell.window.isDestroyed()) return;
    const { width, height } = shell.window.getContentBounds();
    const h = Math.max(0, height - shell.barHeight);
    for (const host of shell.hosts.values()) {
      host.container.setBounds({ x: 0, y: shell.barHeight, width, height: h });
      host.view.setBounds({ x: 0, y: 0, width, height: h });
    }
  }

  // Exactly one tab visible: the active one. Focus follows, so the keys go
  // where the eyes are.
  function show(shell) {
    const activeId = shell.model.activeId;
    for (const [id, host] of shell.hosts) host.container.setVisible(id === activeId);
    const host = activeHost(shell);
    if (host && !host.isDestroyed() && shell.window.isFocused()) host.webContents.focus();
    if (host) host.emit('focus');
    pushState(shell);
  }

  function activate(host) {
    const shell = host.shell;
    if (shell.model.activeId === host.tabId) return;
    shell.model.activate(host.tabId);
    show(shell);
    onChange(shell);
  }

  async function closeTab(host, { confirmed = false } = {}) {
    const shell = host.shell;
    if (host.isDestroyed() || !shell.hosts.has(host.tabId)) return false;
    if (!confirmed) {
      const live = liveSessions(host);
      if (live > 0) {
        const name = tabLabel(host.tab.folder);
        const { response } = await dialog.showMessageBox(shell.window, {
          type: 'question',
          message: `Close ${name}?`,
          detail: `${live === 1 ? 'A session is' : live + ' sessions are'} still running in this tab. Closing it stops ${live === 1 ? 'it' : 'them'}.`,
          buttons: ['Cancel', 'Close Tab'], defaultId: 0, cancelId: 0,
        });
        if (response !== 1) return false;
      }
      const ev = cancellable();
      host.emit('close', ev);
      if (ev.defaultPrevented) return false;
    }
    if (host.isDestroyed()) return false;
    // The last tab takes the window with it, as in a browser. Already asked.
    if (shell.hosts.size === 1) { shell.closeApproved = true; onWindowClose(record(shell)); shell.window.close(); return true; }
    destroyTab(shell, host);
    return true;
  }

  function destroyTab(shell, host, { quiet = false } = {}) {
    if (host.destroyed) return;
    host.destroyed = true;
    shell.model.remove(host.tabId);
    shell.hosts.delete(host.tabId);
    host.emit('closed');
    if (!shell.window.isDestroyed()) shell.window.contentView.removeChildView(host.container);
    if (!host.view.webContents.isDestroyed()) host.view.webContents.close();
    if (!quiet) { show(shell); onChange(shell); }
  }

  function activeHost(shell) {
    return shell ? shell.hosts.get(shell.model.activeId) || null : null;
  }
  function focusedShell() {
    const w = BrowserWindow.getFocusedWindow();
    return (w && byWindow.get(w)) || (lastFocused && shells.has(lastFocused) ? lastFocused : [...shells].pop() || null);
  }
  function shellOf(host) { return host && host.shell && shells.has(host.shell) ? host.shell : null; }
  function record(shell) { return windowRecord({ bounds: shell.window.getNormalBounds(), model: shell.model }); }

  // The renderer adopted a folder. The model follows, and the bar relabels.
  function folderChanged(host, folder) {
    const shell = shellOf(host);
    if (!shell) return;
    shell.model.setFolder(host.tabId, folder);
    pushState(shell);
    onChange(shell);
  }
  // The tab in this window that already has `folder`, other than `host`.
  function otherTabWith(host, folder) {
    const shell = shellOf(host);
    if (!shell || !folder) return null;
    const tab = shell.model.findByFolder(folder);
    return tab && tab.id !== host.tabId ? shell.hosts.get(tab.id) || null : null;
  }

  // ---- the bar --------------------------------------------------------------
  function barState(shell) {
    const activeId = shell.model.activeId;
    return {
      platform,
      fullscreen: shell.fullscreen,
      theme: theme(shell),
      tabs: shell.model.tabs.map((t, i) => {
        const host = shell.hosts.get(t.id);
        return { id: t.id, label: tabLabel(t.folder), title: t.folder || 'No folder', active: t.id === activeId, live: host ? liveSessions(host) : 0, index: i };
      }),
    };
  }
  function pushState(shell, force = false) {
    if (!shell || shell.window.isDestroyed()) return;
    const state = barState(shell);
    const json = JSON.stringify(state);
    if (!force && json === shell.lastState) return;
    shell.lastState = json;
    shell.window.webContents.send('tabs:state', state);
  }
  // Session counts change in main without any tab event; a cheap look twice a
  // second keeps the live dots honest without wiring into the pty code.
  const badgeTimer = setInterval(() => { for (const s of shells) pushState(s); }, 1500);
  if (badgeTimer.unref) badgeTimer.unref();

  function fromBar(event) {
    const shell = byShellWc.get(event.sender.id);
    if (!shell || event.senderFrame !== event.sender.mainFrame) return null;
    return shell;
  }
  ipcMain.handle('tabs:ready', (event) => { const s = fromBar(event); if (!s) return null; s.lastState = ''; return barState(s); });
  ipcMain.handle('tabs:activate', (event, id) => { const s = fromBar(event); const h = s && s.hosts.get(String(id)); if (h) activate(h); return !!h; });
  ipcMain.handle('tabs:close', (event, id) => { const s = fromBar(event); const h = s && s.hosts.get(String(id)); return h ? closeTab(h) : false; });
  ipcMain.handle('tabs:new', (event) => { const s = fromBar(event); if (s) openTab(s, null); return !!s; });
  ipcMain.handle('tabs:move', (event, { id, to } = {}) => {
    const s = fromBar(event);
    if (!s || !s.model.move(String(id), Number(to))) return false;
    pushState(s); onChange(s);
    return true;
  });

  // ---- keys -----------------------------------------------------------------
  function onKey(shell, host, event, input) {
    const action = tabKeyAction(input, { platform });
    if (!action) return;
    const target = activeHost(shell);
    switch (action.type) {
      case 'new-tab': openTab(shell, null); break;
      case 'close-tab': if (target) closeTab(target); break;
      case 'next': if (shell.model.next()) { show(shell); onChange(shell); } break;
      case 'prev': if (shell.model.prev()) { show(shell); onChange(shell); } break;
      case 'select': if (shell.model.byNumber(action.n)) { show(shell); onChange(shell); } break;
      case 'rail': if (target) sendCommand(target, 'rail:' + action.rail); break;
      case 'close-pane':
        // A desk with tiles closes the active tile, exactly as before: let the
        // key through to the page and the menu. An empty one closes the tab.
        if (!target || !deskEmpty(target)) return;
        closeTab(target);
        break;
      default: return;
    }
    event.preventDefault();
  }

  // ---- theme ----------------------------------------------------------------
  function applyTheme(shell) {
    if (!shell || shell.window.isDestroyed()) return;
    const c = shellChrome(shell);
    if (c.titleBarOverlay) { try { shell.window.setTitleBarOverlay(c.titleBarOverlay); } catch (_) {} }
    shell.window.setBackgroundColor(background(shell));
    pushState(shell, true);
  }

  const api = {
    createWindow, openTab, closeTab, activate, activeHost, focusedShell, shellOf, folderChanged, otherTabWith, applyTheme,
    records: () => [...shells].filter((s) => !s.window.isDestroyed()).map(record),
    shells: () => [...shells],
    hostsOf: (shell) => (shell ? shell.model.tabs.map((t) => shell.hosts.get(t.id)).filter(Boolean) : []),
    // Window menu: the tabs of the focused window, in order.
    menuTabs() {
      const shell = focusedShell();
      if (!shell) return [];
      return shell.model.tabs.map((t) => ({ id: t.id, label: tabLabel(t.folder), active: t.id === shell.model.activeId }));
    },
    menuActions() {
      const run = (fn) => () => { const s = focusedShell(); if (s) fn(s); };
      return {
        newTab: run((s) => openTab(s, null)),
        closeTab: run((s) => { const h = activeHost(s); if (h) closeTab(h); }),
        next: run((s) => { if (s.model.next()) { show(s); onChange(s); } }),
        prev: run((s) => { if (s.model.prev()) { show(s); onChange(s); } }),
        select: (id) => run((s) => { const h = s.hosts.get(id); if (h) activate(h); })(),
      };
    },
    BAR_HEIGHT,
  };
  return api;
}

module.exports = { createWorkspaceShells, BAR_HEIGHT, TabHost };
