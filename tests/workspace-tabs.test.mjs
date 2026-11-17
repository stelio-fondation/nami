import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTabModel, tabsFromRecord, windowRecord, tabsEnabled, folderKeyOf, tabLabel, MAX_TABS } = require('../src/main/workspace-tabs.js');
const { tabKeyAction } = require('../src/main/tab-keys.js');
const { createHostRegistry, nativeWindow, toWindowPoint } = require('../src/main/window-host.js');
const { buildMenuTemplate, menuItems } = require('../src/main/app-menu.js');
const { rememberedWindows } = require('../src/main/window-memory.js');

const folders = (m) => m.tabs.map((t) => t.folder);
const activeFolder = (m) => m.active && m.active.folder;

// ---- the model -------------------------------------------------------------

test('a new tab opens beside the tab it was asked from and becomes active', () => {
  const m = createTabModel({ platform: 'darwin' });
  m.add('/a'); m.add('/b');
  m.activate(m.tabs[0].id);
  m.add('/c', { after: m.activeId });
  assert.deepEqual(folders(m), ['/a', '/c', '/b']);
  assert.equal(activeFolder(m), '/c');
});

test('a tab opened in the background leaves the active tab alone', () => {
  const m = createTabModel({ platform: 'darwin' });
  m.add('/a');
  m.add('/b', { activate: false });
  assert.equal(activeFolder(m), '/a');
  m.add('/z');   // no anchor: at the end
  assert.deepEqual(folders(m), ['/a', '/b', '/z']);
});

test('a folder already open switches to its tab instead of opening a second', () => {
  const m = createTabModel({ platform: 'darwin' });
  m.add('/a'); m.add('/b');
  const again = m.add('/a/');
  assert.equal(again.existed, true);
  assert.equal(m.size, 2);
  assert.equal(activeFolder(m), '/a');
});

test('Windows spellings of one folder are one folder', () => {
  const m = createTabModel({ platform: 'win32' });
  m.add('D:\\projets\\Nami');
  assert.equal(m.add('d:/projets/nami/').existed, true);
  assert.equal(m.size, 1);
  // …but case still matters where the file system says it does
  const mac = createTabModel({ platform: 'linux' });
  mac.add('/src/Nami');
  assert.equal(mac.add('/src/nami').existed, false);
});

test('one empty tab per window: ⌘T on a window that has one goes to it', () => {
  const m = createTabModel({ platform: 'darwin' });
  m.add(null); m.add('/a');
  const again = m.add(null);
  assert.equal(again.existed, true);
  assert.equal(activeFolder(m), null);
  assert.equal(m.size, 2);
});

test('closing the active tab lands on its right neighbour, or the left at the end', () => {
  const m = createTabModel({ platform: 'darwin' });
  const [a, b, c] = ['/a', '/b', '/c'].map((f) => m.add(f).tab);
  m.activate(b.id);
  m.remove(b.id);
  assert.equal(activeFolder(m), '/c');
  m.remove(c.id);
  assert.equal(activeFolder(m), '/a');
  m.remove(a.id);
  assert.equal(m.active, null);
});

test('closing a background tab keeps the active one', () => {
  const m = createTabModel({ platform: 'darwin' });
  const a = m.add('/a').tab; m.add('/b');
  m.remove(a.id);
  assert.equal(activeFolder(m), '/b');
});

test('next and previous wrap around', () => {
  const m = createTabModel({ platform: 'darwin' });
  ['/a', '/b', '/c'].forEach((f) => m.add(f));
  m.next();
  assert.equal(activeFolder(m), '/a');
  m.prev();
  assert.equal(activeFolder(m), '/c');
});

test('⌘1…⌘8 are positions and ⌘9 is always the last tab', () => {
  const m = createTabModel({ platform: 'darwin' });
  ['/a', '/b', '/c'].forEach((f) => m.add(f));
  m.byNumber(1); assert.equal(activeFolder(m), '/a');
  m.byNumber(9); assert.equal(activeFolder(m), '/c');
  assert.equal(m.byNumber(5), null);
  assert.equal(activeFolder(m), '/c');
});

test('a tab cannot take a folder another tab already has', () => {
  const m = createTabModel({ platform: 'darwin' });
  const a = m.add('/a').tab; const b = m.add('/b').tab;
  const res = m.setFolder(b.id, '/a');
  assert.equal(res.conflict.id, a.id);
  assert.equal(b.folder, '/b');
  m.setFolder(b.id, '/c');
  assert.equal(b.folder, '/c');
});

test('tabs can be reordered, and the active tab follows its folder', () => {
  const m = createTabModel({ platform: 'darwin' });
  const a = m.add('/a').tab; m.add('/b'); m.add('/c');
  m.activate(a.id);
  m.move(a.id, 2);
  assert.deepEqual(folders(m), ['/b', '/c', '/a']);
  assert.equal(m.snapshot().active, 2);
});

test('a window holds at most MAX_TABS tabs', () => {
  const m = createTabModel({ platform: 'darwin' });
  for (let i = 0; i < MAX_TABS; i++) m.add('/f' + i);
  assert.equal(m.add('/one-more').full, true);
  assert.equal(m.size, MAX_TABS);
});

// ---- what is written down, and what comes back -------------------------------

test('a window record carries its tabs, its active tab, and that tab as `folder`', () => {
  const m = createTabModel({ platform: 'darwin' });
  m.add('/a'); m.add('/b'); m.activate(m.tabs[0].id);
  const rec = windowRecord({ bounds: { x: 1, y: 2, width: 3, height: 4 }, model: m });
  assert.deepEqual(rec, { folder: '/a', bounds: { x: 1, y: 2, width: 3, height: 4 }, tabs: [{ folder: '/a' }, { folder: '/b' }], active: 0 });
});

test('a record round-trips through JSON into the same tabs', () => {
  const m = createTabModel({ platform: 'darwin' });
  ['/a', '/b', '/c'].forEach((f) => m.add(f));
  m.activate(m.tabs[1].id);
  const back = tabsFromRecord(JSON.parse(JSON.stringify(windowRecord({ bounds: {}, model: m }))), 'darwin');
  assert.deepEqual(back, { tabs: [{ folder: '/a' }, { folder: '/b' }, { folder: '/c' }], active: 1 });
});

test('a record from before tabs reopens as one tab on its folder', () => {
  assert.deepEqual(tabsFromRecord({ folder: '/old', bounds: {} }, 'darwin'), { tabs: [{ folder: '/old' }], active: 0 });
  assert.deepEqual(tabsFromRecord({ folder: null }, 'darwin'), { tabs: [{ folder: null }], active: 0 });
  assert.deepEqual(tabsFromRecord(null, 'darwin'), { tabs: [{ folder: null }], active: 0 });
});

test('a hand-edited record is cleaned: duplicates dropped, junk ignored, active clamped', () => {
  const rec = { tabs: [{ folder: 'C:\\w' }, { folder: 'c:/w/' }, 'junk', { folder: 42 }, { folder: 'C:\\x' }], active: 1 };
  assert.deepEqual(tabsFromRecord(rec, 'win32'), { tabs: [{ folder: 'C:\\w' }, { folder: null }, { folder: 'C:\\x' }], active: 0 });
  assert.equal(tabsFromRecord({ tabs: [{ folder: '/a' }], active: 7 }, 'darwin').active, 0);
  assert.deepEqual(tabsFromRecord({ tabs: [] }, 'darwin'), { tabs: [{ folder: null }], active: 0 });
});

test('off the Mac, the last window to close is remembered with all its tabs', () => {
  const lastClosed = { folder: '/b', bounds: {}, tabs: [{ folder: '/a' }, { folder: '/b' }], active: 1 };
  assert.deepEqual(rememberedWindows({ open: [], lastClosed, platform: 'win32' }), [lastClosed]);
  assert.deepEqual(rememberedWindows({ open: [], lastClosed, platform: 'darwin' }), []);
});

test('the flag: on by default, NAMI_TABS beats the setting, screenshots force it off', () => {
  assert.equal(tabsEnabled({ env: {}, settings: {} }), true);
  assert.equal(tabsEnabled({ env: { NAMI_TABS: '0' }, settings: {} }), false);
  assert.equal(tabsEnabled({ env: {}, settings: { workspaceTabs: false } }), false);
  assert.equal(tabsEnabled({ env: { NAMI_TABS: '1' }, settings: { workspaceTabs: false } }), true);
  assert.equal(tabsEnabled({ env: { NAMI_TABS: '1' }, settings: {}, forcedOff: true }), false);
});

test('folder keys and labels', () => {
  assert.equal(folderKeyOf('/a/b/', 'darwin'), '/a/b');
  assert.equal(folderKeyOf('/', 'darwin'), '/');
  assert.equal(folderKeyOf('C:/A/', 'win32'), 'c:\\a');
  assert.equal(folderKeyOf(null, 'darwin'), '');
  assert.equal(tabLabel('/Users/me/nami'), 'nami');
  assert.equal(tabLabel('D:\\projets\\naminus\\'), 'naminus');
  assert.equal(tabLabel(null), 'No folder');
});

// ---- keys ------------------------------------------------------------------

const k = (key, mods = {}, code) => ({ type: 'keyDown', key, code, control: false, meta: false, alt: false, shift: false, ...mods });

test('tab keys on a Mac', () => {
  const mac = { platform: 'darwin' };
  assert.deepEqual(tabKeyAction(k('t', { meta: true }, 'KeyT'), mac), { type: 'new-tab' });
  assert.deepEqual(tabKeyAction(k('w', { meta: true }, 'KeyW'), mac), { type: 'close-pane' });
  assert.deepEqual(tabKeyAction(k('W', { meta: true, shift: true }, 'KeyW'), mac), { type: 'close-tab' });
  assert.deepEqual(tabKeyAction(k('Tab', { control: true }), mac), { type: 'next' });
  assert.deepEqual(tabKeyAction(k('Tab', { control: true, shift: true }), mac), { type: 'prev' });
  assert.deepEqual(tabKeyAction(k('3', { meta: true }, 'Digit3'), mac), { type: 'select', n: 3 });
  // ⌥ turns the digit into a symbol on a Mac; the physical key still counts
  assert.deepEqual(tabKeyAction(k('£', { meta: true, alt: true }, 'Digit3'), mac), { type: 'rail', rail: 'library' });
  assert.equal(tabKeyAction(k('4', { meta: true, alt: true }, 'Digit4'), mac), null);
  // Ctrl+T is a terminal key on a Mac, and ⌘ is not Ctrl
  assert.equal(tabKeyAction(k('t', { control: true }, 'KeyT'), mac), null);
  assert.equal(tabKeyAction(k('1', { control: true }, 'Digit1'), mac), null);
});

test('tab keys on Windows: Ctrl, and Ctrl+F4 for close because Ctrl+Shift+W is Close Pane', () => {
  const win = { platform: 'win32' };
  assert.deepEqual(tabKeyAction(k('t', { control: true }, 'KeyT'), win), { type: 'new-tab' });
  assert.deepEqual(tabKeyAction(k('F4', { control: true }, 'F4'), win), { type: 'close-tab' });
  assert.deepEqual(tabKeyAction(k('w', { control: true }, 'KeyW'), win), { type: 'close-pane' });
  assert.deepEqual(tabKeyAction(k('W', { control: true, shift: true }, 'KeyW'), win), { type: 'close-pane' });
  assert.deepEqual(tabKeyAction(k('1', { control: true }, 'Digit1'), win), { type: 'select', n: 1 });
  assert.deepEqual(tabKeyAction(k('2', { control: true, alt: true }, 'Digit2'), win), { type: 'rail', rail: 'workspace' });
  // Ctrl+Shift+T stays New Session (term-keys.mjs)
  assert.equal(tabKeyAction(k('T', { control: true, shift: true }, 'KeyT'), win), null);
  // AltGr arrives as Ctrl+Alt: no rail for keys that are not 1–3
  assert.equal(tabKeyAction(k('@', { control: true, alt: true }, 'Digit0'), win), null);
});

test('keys that are not tab keys, and key-ups, pass through', () => {
  assert.equal(tabKeyAction(k('a', { meta: true }, 'KeyA'), { platform: 'darwin' }), null);
  assert.equal(tabKeyAction({ ...k('t', { meta: true }, 'KeyT'), type: 'keyUp' }, { platform: 'darwin' }), null);
  assert.equal(tabKeyAction({ ...k('t', { meta: true }, 'KeyT'), isAutoRepeat: true }, { platform: 'darwin' }), null);
  assert.deepEqual(tabKeyAction({ ...k('Tab', { control: true }), isAutoRepeat: true }, { platform: 'darwin' }), { type: 'next' });
  assert.equal(tabKeyAction(null), null);
});

// ---- hosts -------------------------------------------------------------------

function fakeWc(id) {
  const listeners = {};
  return { id, once: (ev, fn) => { listeners[ev] = fn; }, destroy: () => listeners.destroyed && listeners.destroyed() };
}

test('a tab is found by its own sender, and its window is the shell', () => {
  const shellWindow = { isDestroyed: () => false };
  const tabWc = fakeWc(7);
  const tab = { webContents: tabWc, window: shellWindow, offset: { x: 0, y: 36 } };
  const reg = createHostRegistry({ BrowserWindow: { fromWebContents: () => shellWindow, getAllWindows: () => [] } });
  reg.register(tab);
  assert.equal(reg.hostFor(tabWc), tab);
  assert.equal(reg.hostById(7), tab);
  assert.equal(reg.ownerWindow(tabWc), shellWindow);
  assert.deepEqual(toWindowPoint(tab, { x: 10, y: 5 }), { x: 10, y: 41 });
  tabWc.destroy();
  assert.equal(reg.hostById(7), null);
});

test('without registration, only a window\'s own page counts as that window', () => {
  const page = fakeWc(1), guest = fakeWc(2);
  const w = { webContents: page, isDestroyed: () => false };
  const reg = createHostRegistry({ BrowserWindow: { fromWebContents: () => w, getAllWindows: () => [w] } });
  assert.equal(reg.hostFor(page), w);
  assert.equal(reg.hostFor(guest), null);
  assert.equal(reg.hostById(1), w);
  assert.equal(nativeWindow(w), w);
  assert.deepEqual(toWindowPoint(w, { x: 3, y: 4 }), { x: 3, y: 4 });
});

// ---- the menu ----------------------------------------------------------------

const noop = () => {};
const tabs = { list: [{ id: 't1', label: 'alpha', active: false }, { id: 't2', label: 'beta', active: true }], newTab: noop, closeTab: noop, next: noop, prev: noop, select: noop };

test('without tabs the menu is exactly upstream\'s', () => {
  for (const platform of ['darwin', 'win32']) {
    const plain = buildMenuTemplate({ send: noop, open: noop, newWindow: noop, platform });
    const off = buildMenuTemplate({ send: noop, open: noop, newWindow: noop, platform, tabs: null });
    const shape = (t) => JSON.stringify(menuItems(t).map((i) => [i.label, i.role, i.accelerator]));
    assert.equal(shape(off), shape(plain));
    assert.ok(menuItems(plain).some((i) => i.label === 'Sessions' && i.accelerator === 'CommandOrControl+1'));
  }
});

test('with tabs: New Tab, Close Tab, the tab list on ⌘1…, and the sidebar on ⌥⌘1…', () => {
  const mac = menuItems(buildMenuTemplate({ send: noop, open: noop, newWindow: noop, platform: 'darwin', tabs }));
  const by = (label) => mac.find((i) => i.label === label);
  assert.equal(by('New Tab').accelerator, 'CommandOrControl+T');
  assert.equal(by('Close Tab').accelerator, 'Shift+Command+W');
  assert.equal(by('Close Pane').accelerator, 'CommandOrControl+W');
  assert.equal(by('Show Next Tab').accelerator, 'Control+Tab');
  assert.equal(by('alpha').accelerator, 'CommandOrControl+1');
  assert.equal(by('beta').checked, true);
  assert.equal(by('Sessions').accelerator, 'Alt+CommandOrControl+1');
  const win = menuItems(buildMenuTemplate({ send: noop, open: noop, newWindow: noop, platform: 'win32', tabs }));
  assert.equal(win.find((i) => i.label === 'Close Tab').accelerator, 'Control+F4');
  // no accelerator is claimed twice
  for (const items of [mac, win]) {
    const keys = items.map((i) => i.accelerator).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, keys.join(' '));
  }
});
