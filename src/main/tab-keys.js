// Which tab command a key press is, read in main before the page sees it.
//
// The menu alone is not enough. Off a Mac a menu accelerator only fires for a
// key the page left alone, and a focused terminal leaves nothing alone: xterm
// takes Ctrl+T, Ctrl+Tab and Ctrl+digit as terminal input and cancels them, so
// the tab keys would work everywhere except where people actually are. Reading
// them in before-input-event puts them ahead of the page and of the menu on
// every platform, and preventDefault there keeps the menu from running the same
// command a second time.
//
// Pure: `input` is Electron's before-input-event Input; the caller acts.
//
//   new-tab          ⌘T / Ctrl+T
//   close-tab        ⇧⌘W on a Mac, Ctrl+F4 elsewhere (Ctrl+Shift+W is Close
//                    Pane there — see term-keys.mjs)
//   close-pane       ⌘W / Ctrl+W / Ctrl+Shift+W — the caller closes the tab
//                    when the desk is empty and otherwise lets the key through
//   next / prev      Ctrl+Tab / Ctrl+Shift+Tab, everywhere
//   select n         ⌘1…⌘9 / Ctrl+1…Ctrl+9
//   rail             ⌥⌘1/2/3 / Ctrl+Alt+1/2/3 — where the sidebar tabs moved
//                    when ⌘1…3 became tab keys

const RAILS = ['sessions', 'workspace', 'library'];

function digitOf(input) {
  const m = /^Digit([1-9])$/.exec(String(input.code || ''));
  if (m) return Number(m[1]);
  return /^[1-9]$/.test(String(input.key || '')) ? Number(input.key) : 0;
}
function letterOf(input) {
  const m = /^Key([A-Z])$/.exec(String(input.code || ''));
  if (m) return m[1].toLowerCase();
  const k = String(input.key || '');
  return /^[a-z]$/i.test(k) ? k.toLowerCase() : '';
}

function tabKeyAction(input, { platform = process.platform } = {}) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat && String(input.key) !== 'Tab') return null;
  const mac = platform === 'darwin';
  const { control = false, meta = false, alt = false, shift = false } = input;

  if (control && !meta && !alt && String(input.key) === 'Tab') return { type: shift ? 'prev' : 'next' };

  const mod = mac ? (meta && !control) : (control && !meta);
  if (!mod) return null;

  const digit = digitOf(input);
  if (digit && !shift) {
    if (alt) return digit <= 3 ? { type: 'rail', rail: RAILS[digit - 1] } : null;
    return { type: 'select', n: digit };
  }
  if (alt) return null;

  if (!mac && !shift && String(input.key) === 'F4') return { type: 'close-tab' };
  const letter = letterOf(input);
  if (letter === 't' && !shift) return { type: 'new-tab' };
  if (letter === 'w') {
    if (mac) return { type: shift ? 'close-tab' : 'close-pane' };
    return { type: 'close-pane' };
  }
  return null;
}

module.exports = { tabKeyAction, RAILS };
