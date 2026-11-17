// The tabs of one Nami window, and how they are written down.
//
// A tab is a folder: the tab bar is the multi-workspace answer to "a window per
// folder", so the same rule carries over — one desk per folder, never two. A
// second tab on a folder already open in the window would be two renderers
// writing the same panelsByFolder entry, the same trap the panel-id prefix in
// main.js exists for. Asking for it again therefore switches to the tab that
// has it. "No folder" counts as a folder here: one empty tab per window.
//
// Pure, like window-memory.js: workspace-shell.js owns the views, this owns the
// decisions, and node --test can check them without an Electron.

const MAX_TABS = 20;

// How two spellings of a folder are told to be the same folder. Windows paths
// are case-insensitive and take either slash; a trailing separator is noise
// everywhere. Not a realpath: that is I/O, and a symlinked folder opened by its
// two names is rare enough to be two tabs.
function folderKeyOf(folder, platform = process.platform) {
  if (!folder || typeof folder !== 'string') return '';
  let p = folder;
  if (platform === 'win32') p = p.replace(/\//g, '\\');
  const trimmed = p.replace(/[\\/]+$/, '');
  p = trimmed || p;
  return platform === 'win32' ? p.toLowerCase() : p;
}

// What a tab is called: the folder's last segment, as the menu names recents.
function tabLabel(folder) {
  const parts = String(folder || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || (folder ? String(folder) : 'No folder');
}

function createTabModel({ platform = process.platform } = {}) {
  const list = [];
  let activeId = null;
  let seq = 0;
  const key = (folder) => folderKeyOf(folder, platform);
  const find = (id) => list.find((t) => t.id === id) || null;
  const findByFolder = (folder) => list.find((t) => key(t.folder) === key(folder)) || null;

  // A new tab opens beside the one it was asked for from, the way a browser
  // does, or at the end. Returns whether the folder already had one.
  function add(folder, { activate = true, after = null } = {}) {
    folder = folder || null;
    const existing = findByFolder(folder);
    if (existing) {
      if (activate) activeId = existing.id;
      return { tab: existing, existed: true };
    }
    if (list.length >= MAX_TABS) return { tab: null, existed: false, full: true };
    seq += 1;
    const tab = { id: 't' + seq, folder };
    const at = after ? list.findIndex((t) => t.id === after) : -1;
    if (at >= 0) list.splice(at + 1, 0, tab); else list.push(tab);
    if (activate || !activeId) activeId = tab.id;
    return { tab, existed: false };
  }

  // Closing the active tab lands on its right neighbour, or the left one when
  // it was last — what every browser does, so nobody has to learn it.
  function remove(id) {
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return activeId;
    list.splice(i, 1);
    if (activeId === id) activeId = list.length ? list[Math.min(i, list.length - 1)].id : null;
    return activeId;
  }

  function activate(id) { if (find(id)) activeId = id; return activeId; }

  function cycle(step) {
    if (!list.length) return null;
    const i = Math.max(0, list.findIndex((t) => t.id === activeId));
    activeId = list[(i + step + list.length) % list.length].id;
    return activeId;
  }

  // ⌘1…⌘8 are positions; ⌘9 is always the last tab, as in every browser.
  function byNumber(n) {
    if (!Number.isInteger(n) || n < 1 || n > 9 || !list.length) return null;
    const tab = n === 9 ? list[list.length - 1] : list[n - 1];
    if (!tab) return null;
    activeId = tab.id;
    return activeId;
  }

  // The renderer switched this tab's folder. Refused when another tab already
  // has it, so the caller can switch there instead.
  function setFolder(id, folder) {
    const tab = find(id);
    if (!tab) return { tab: null };
    const other = findByFolder(folder);
    if (other && other.id !== id) return { tab, conflict: other };
    tab.folder = folder || null;
    return { tab };
  }

  function move(id, toIndex) {
    const i = list.findIndex((t) => t.id === id);
    if (i < 0 || !Number.isInteger(toIndex)) return false;
    const [tab] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, tab);
    return true;
  }

  function snapshot() {
    return {
      tabs: list.map((t) => ({ folder: t.folder })),
      active: Math.max(0, list.findIndex((t) => t.id === activeId)),
    };
  }

  return {
    get tabs() { return list.slice(); },
    get size() { return list.length; },
    get activeId() { return activeId; },
    get active() { return find(activeId); },
    find, findByFolder, add, remove, activate, byNumber, setFolder, move, snapshot,
    next: () => cycle(1),
    prev: () => cycle(-1),
    indexOf: (id) => list.findIndex((t) => t.id === id),
  };
}

// The tabs a window reopens with, from whatever state.json holds. A record from
// before tabs ({ folder, bounds }) is a window with one tab. Duplicates are
// dropped rather than trusted: the file can be edited by hand, and an older
// build may have written two windows that a merge turned into one.
function tabsFromRecord(record, platform = process.platform) {
  const asFolder = (f) => (typeof f === 'string' && f ? f : null);
  const raw = record && typeof record === 'object'
    ? (Array.isArray(record.tabs) ? record.tabs.filter((t) => t && typeof t === 'object').map((t) => asFolder(t.folder)) : [asFolder(record.folder)])
    : [null];
  const wanted = record && Number.isInteger(record.active) ? record.active : 0;
  const seen = new Set();
  const tabs = [];
  let active = 0;
  raw.forEach((folder, i) => {
    const k = folderKeyOf(folder, platform);
    if (seen.has(k) || tabs.length >= MAX_TABS) {
      if (i === wanted) active = [...seen].indexOf(k);
      return;
    }
    seen.add(k);
    if (i === wanted) active = tabs.length;
    tabs.push({ folder });
  });
  if (!tabs.length) tabs.push({ folder: null });
  return { tabs, active: Math.max(0, Math.min(active, tabs.length - 1)) };
}

// One window, as state.windows stores it. `folder` mirrors the active tab, so a
// Nami that does not know about tabs — this fork with NAMI_TABS=0, or the
// upstream build — reads the record as the window it most looked like.
function windowRecord({ bounds, model }) {
  const { tabs, active } = model.snapshot();
  return { folder: (tabs[active] && tabs[active].folder) || null, bounds, tabs, active };
}

// On unless switched off. NAMI_TABS beats the setting, so a single launch can
// go back to one-folder windows without touching settings.json; screenshot and
// demo runs always get the classic window, which their fixtures are made for.
function tabsEnabled({ env = process.env, settings = {}, forcedOff = false } = {}) {
  if (forcedOff) return false;
  const v = String((env && env.NAMI_TABS) || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  return !(settings && settings.workspaceTabs === false);
}

module.exports = { createTabModel, tabsFromRecord, windowRecord, tabsEnabled, folderKeyOf, tabLabel, MAX_TABS };
