// Who an IPC message came from, now that a renderer is not always a window.
//
// With workspace tabs, Nami's renderers live in WebContentsViews inside a shell
// window, and BrowserWindow.fromWebContents(sender) answers with that shell
// (checked against Electron 43). Every handler that compared the answer's
// webContents with the sender — "is this the app window talking?" — would turn
// every tab away. So a renderer is a *host*: a BrowserWindow in the classic
// mode, a tab (workspace-shell.js) in the tabbed one. Both carry webContents,
// contentView and the window events the browser modules listen for, and this
// registry maps a sender back to its host.
//
// ownerWindow is the native window, for what needs a real one: a dialog's
// parent, a menu popup.

function createHostRegistry({ BrowserWindow } = {}) {
  const byWc = new Map();

  function register(host) {
    const wc = host && host.webContents;
    if (!wc) return host;
    const id = wc.id;
    byWc.set(id, host);
    wc.once('destroyed', () => { if (byWc.get(id) === host) byWc.delete(id); });
    return host;
  }
  function hostFor(sender) {
    if (!sender) return null;
    const host = byWc.get(sender.id);
    if (host) return host;
    // Classic windows that were never registered (and tests): the old answer,
    // and only when it is the window's own page asking.
    const w = BrowserWindow ? BrowserWindow.fromWebContents(sender) : null;
    return w && w.webContents === sender ? w : null;
  }
  function hostById(id) {
    const host = byWc.get(id);
    if (host) return host;
    if (!BrowserWindow) return null;
    return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.id === id) || null;
  }
  function ownerWindow(sender) {
    const host = byWc.get(sender && sender.id);
    if (host) return nativeWindow(host);
    return BrowserWindow && sender ? BrowserWindow.fromWebContents(sender) : null;
  }
  return { register, hostFor, hostById, ownerWindow, all: () => [...byWc.values()] };
}

// A tab's window is its shell; a window is its own.
function nativeWindow(host) {
  if (!host) return null;
  return host.window || host;
}

// Where a point in a renderer's own pixels is in its window. A tab sits below
// the tab bar; a window's page starts at its corner.
function toWindowPoint(host, { x = 0, y = 0 } = {}) {
  const off = (host && host.offset) || { x: 0, y: 0 };
  return { x: Math.round(x + off.x), y: Math.round(y + off.y) };
}

module.exports = { createHostRegistry, nativeWindow, toWindowPoint };
