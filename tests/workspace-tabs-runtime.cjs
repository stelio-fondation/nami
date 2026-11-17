// Workspace tabs in a real Electron: three folders in three tabs of one window,
// a live PTY in each, switching by keyboard while they run, the browser pane
// inside its own tab, folder dedupe, and the window written back on quit.
//
//   xvfb-run -a npx electron tests/workspace-tabs-runtime.cjs   (Linux)
//   npx electron tests/workspace-tabs-runtime.cjs                (macOS/Windows)
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-tabs-runtime-'));
const folders = ['alpha', 'beta', 'gamma'].map((n) => { const p = path.join(root, n); fs.mkdirSync(p); return p; });
const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify({ currentFolder: folders[0], windows: [{ bounds: { x: 0, y: 0, width: 1200, height: 800 }, tabs: folders.map((folder) => ({ folder })), active: 1 }] }));
const profiles = require('../src/main/browser-profiles'); profiles.detectChromiumProfiles = () => []; profiles.cookieImportStatus = () => ({ available: false, browsers: [] });
delete process.env.NAMI_TABS;
process.argv.push('--review', '--user-data', profile);
require('../src/main/main');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, tries = 200) { for (let i = 0; i < tries; i++) { if (await fn()) return; await pause(50); } throw Error('Timed out: ' + label); }
const timer = setTimeout(() => { console.error('FAIL: timed out'); app.exit(1); }, 60000);
const mod = process.platform === 'darwin' ? 'meta' : 'control';
const shellPage = () => webContents.getAllWebContents().find((wc) => wc.getURL().endsWith('/tabbar.html'));
const tabPages = () => webContents.getAllWebContents().filter((wc) => wc.getURL().endsWith('/renderer/index.html'));
const barActive = () => shellPage().executeJavaScript('document.querySelector(".tab.active .tab-label").textContent');
function key(wc, keyCode, modifiers) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

app.whenReady().then(async () => {
  try {
    await until(() => tabPages().length === 3 && tabPages().every((wc) => !wc.isLoading()), 'three tabs');
    await until(() => shellPage() && !shellPage().isLoading(), 'tab bar');
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'one native window');
    const win = BrowserWindow.getAllWindows()[0];
    const pages = tabPages();
    // Each tab booted on its own folder, through the app's own trusted bridge.
    const project = (wc) => wc.executeJavaScript('dainami.boot().then(b => b.currentFolder && b.currentFolder.path)');
    const booted = await Promise.all(pages.map(project));
    assert.deepEqual(booted.sort(), folders.slice().sort());
    console.log('PASS: one window holds three tabs, each booted on its own folder.');
    assert.equal(await barActive(), 'beta', 'the saved active tab is the one shown');

    // A tab's view sits under the bar; exactly one tab is visible.
    const containers = win.contentView.children;
    assert.equal(containers.length, 3);
    assert.ok(containers.every((c) => c.getBounds().y === 36), 'tabs start below the bar');
    assert.equal(containers.filter((c) => c.getVisible()).length, 1);

    // A live session in every tab, writing while another tab is in front.
    const byFolder = new Map();
    for (const wc of pages) byFolder.set(await project(wc), wc);
    for (const [i, folder] of folders.entries()) {
      const wc = byFolder.get(folder);
      await wc.executeJavaScript(`window.tabOut="";dainami.onTermData(e=>{if(e.id==="tab-${i}")window.tabOut+=e.data;});true`);
      const made = await wc.executeJavaScript(`dainami.termCreate(${JSON.stringify({ id: 'tab-' + i, cwd: folder, kind: 'harness', program: '/bin/sh', args: ['-c', `for n in 1 2 3 4 5 6; do echo tick-${i}-$n; sleep 0.3; done`], cols: 80, rows: 24 })})`);
      assert.equal(made.ok, true, 'session starts in tab ' + i);
    }
    const front = byFolder.get(folders[1]);
    front.focus();
    key(front, 'Tab', ['control']);                 // next → gamma
    await until(async () => (await barActive()) === 'gamma', 'ctrl+tab');
    key(byFolder.get(folders[2]), '1', [mod]);      // ⌘1 → alpha
    await until(async () => (await barActive()) === 'alpha', 'mod+1');
    key(byFolder.get(folders[0]), 'Tab', ['control', 'shift']); // prev → gamma (wraps)
    await until(async () => (await barActive()) === 'gamma', 'ctrl+shift+tab');
    for (const [i, folder] of folders.entries()) {
      await until(() => byFolder.get(folder).executeJavaScript(`window.tabOut.includes("tick-${i}-6")`), 'output of tab ' + i);
    }
    console.log('PASS: sessions in all three tabs keep running and delivering output across tab switches.');

    // Asking a tab for a folder another tab has switches there instead.
    const answer = await byFolder.get(folders[2]).executeJavaScript(`dainami.openFolder(${JSON.stringify(folders[0])}, false)`);
    assert.equal(answer, null);
    await until(async () => (await barActive()) === 'alpha', 'dedupe switches tab');
    console.log('PASS: a folder already open in a tab is switched to, never opened twice.');

    // The browser pane lives in its tab's view and hides with it.
    const alpha = byFolder.get(folders[0]);
    await alpha.executeJavaScript('dainami.browserEnable(true)');
    const created = await alpha.executeJavaScript(`dainami.browserCreate({ id: 'tab-browser', owner: 'p1', url: 'about:blank' })`);
    assert.equal(created.ok, true, 'browser:create from a tab: ' + JSON.stringify(created));
    await alpha.executeJavaScript(`dainami.browserLayout({ items: [{ id: 'tab-browser', x: 40, y: 50, width: 300, height: 200 }] })`);
    const alphaContainer = containers.find((c) => c.children.some((v) => v.webContents === alpha));
    const guest = alphaContainer.children.find((v) => v.webContents && v.webContents !== alpha);
    assert.ok(guest, 'browser view is a child of its tab');
    assert.deepEqual(guest.getBounds(), { x: 40, y: 50, width: 300, height: 200 });
    key(alpha, '2', [mod]);
    await until(async () => (await barActive()) === 'beta', 'switch away from browser tab');
    assert.equal(alphaContainer.getVisible(), false, 'the browser tab is hidden with its tab');
    console.log('PASS: the browser pane is placed in its tab\'s coordinates and hidden with it.');

    // A tab knows it is one, and the switch sheet's "new tab" lands in this
    // window — on the tab that already has the folder, when one does.
    assert.equal(await alpha.executeJavaScript('dainami.tabs'), true);
    await byFolder.get(folders[1]).executeJavaScript(`dainami.newTab(${JSON.stringify(folders[2])})`);
    await until(async () => (await barActive()) === 'gamma', 'newTab dedupes to gamma');
    assert.equal(tabPages().length, 3);
    key(byFolder.get(folders[2]), '2', [mod]);
    await until(async () => (await barActive()) === 'beta', 'back to beta');
    console.log('PASS: "open in a new tab" reuses the tab that has the folder.');

    // One window, one look: a theme picked in one tab reaches the bar and the others.
    await alpha.executeJavaScript(`dainami.themeApplied('dusk')`);
    await until(() => byFolder.get(folders[2]).executeJavaScript('document.body.dataset.theme === "dusk"'), 'theme reaches a sibling tab');
    await until(() => shellPage().executeJavaScript('document.body.dataset.theme === "dusk"'), 'theme reaches the bar');
    console.log('PASS: a theme change in one tab applies to the tab bar and every tab of the window.');

    // A background tab whose agent goes quiet turns green, until it is visited.
    const gammaWc = byFolder.get(folders[2]);
    const tabState = (label) => shellPage().executeJavaScript(`(() => { const t = [...document.querySelectorAll('.tab')].find(e => e.querySelector('.tab-label').textContent === ${JSON.stringify(label)}); const d = t && t.querySelector('.tab-dot'); return t ? { done: t.classList.contains('done'), dot: d ? d.className : '' } : null; })()`);
    await gammaWc.executeJavaScript(`dainami.termCreate(${JSON.stringify({ id: 'quiet', cwd: folders[2], kind: 'harness', program: '/bin/sh', args: ['-c', 'for n in 1 2 3; do echo busy-$n; sleep 0.4; done; sleep 30'], cols: 80, rows: 24 })})`);
    await until(async () => (await tabState('gamma')).dot.includes('working'), 'gamma working', 100);
    assert.equal((await tabState('gamma')).done, false);
    await until(async () => (await tabState('gamma')).done, 'gamma turns green when quiet', 200);
    assert.ok((await tabState('gamma')).dot.includes('idle'));
    key(byFolder.get(folders[1]), '3', [mod]);
    await until(async () => !(await tabState('gamma')).done, 'visiting clears it');
    assert.ok((await tabState('gamma')).dot.includes('idle'));
    key(gammaWc, '2', [mod]);
    await until(async () => (await barActive()) === 'beta', 'back to beta again');
    console.log('PASS: a working tab pulses amber, turns green in the background when its agent goes quiet, and clears once visited.');

    // New tab, then ⌘W on its empty desk closes it.
    key(byFolder.get(folders[1]), 'T', [mod]);
    await until(() => tabPages().length === 4, 'new tab');
    await until(async () => (await barActive()) === 'No folder', 'new tab is active');
    const fresh = tabPages().find((wc) => !pages.includes(wc));
    await until(() => !fresh.isLoading(), 'new tab loads');
    await pause(300);
    key(fresh, 'W', [mod]);
    await until(() => tabPages().length === 3, 'mod+w closes the empty tab');
    console.log('PASS: new tab opens empty and ⌘W closes it when its desk is empty.');

    // Quit writes the window back with its tabs and the active one.
    await alpha.executeJavaScript('true');
    app.once('will-quit', () => {
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
        assert.equal(saved.windows.length, 1);
        assert.deepEqual(saved.windows[0].tabs.map((t) => t.folder), folders);
        // The closed tab sat right of beta, so its right neighbour took over.
        assert.equal(saved.windows[0].active, 2);
        assert.equal(saved.windows[0].folder, folders[2]);
        console.log('PASS: quitting records the window with its tabs, in order, and the active one.');
        clearTimeout(timer);
        process.exitCode = 0;
      } catch (error) { console.error('FAIL:', error.stack || error); process.exitCode = 1; }
    });
    app.quit();
  } catch (error) {
    console.error('FAIL:', error.stack || error);
    app.exit(1);
  }
});
