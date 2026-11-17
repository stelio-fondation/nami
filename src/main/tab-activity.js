// Whether a tab's sessions are working, read from their terminals.
//
// Nami knows a session is open; it does not know whether the agent inside is
// busy. Only the chat panes report that, and Codex or Claude Code in a terminal
// say nothing. What they do is write: a working agent repaints its spinner and
// streams its output, a waiting one is quiet. So a session that wrote in the
// last few seconds is working, one that has been quiet longer is at rest. What
// you type comes back as echo, which is not work: output that follows a key
// press closely is not counted.
//
// Pure: main.js feeds it timestamps, workspace-shell.js asks for a verdict.

const QUIET_MS = 4000;   // quiet this long after its last output: at rest
const ECHO_MS = 300;     // output this soon after input: the echo of typing

function createActivityLog({ now = () => Date.now() } = {}) {
  const sessions = new Map();   // id -> { out, inp }
  const entry = (id) => { let e = sessions.get(id); if (!e) { e = { out: 0, inp: 0 }; sessions.set(id, e); } return e; };
  return {
    input(id) { entry(id).inp = now(); },
    output(id) {
      const e = entry(id), t = now();
      if (e.inp && t - e.inp <= ECHO_MS) return;
      e.out = t;
    },
    forget(id) { sessions.delete(id); },
    lastOutput(id) { const e = sessions.get(id); return e ? e.out : 0; },
  };
}

// 'none' (no session), 'working' (one wrote recently) or 'idle'.
function tabActivity({ outputs = [], now = Date.now(), quietMs = QUIET_MS } = {}) {
  if (!outputs.length) return { state: 'none', live: 0, working: 0 };
  const working = outputs.filter((t) => t && now - t < quietMs).length;
  return { state: working ? 'working' : 'idle', live: outputs.length, working };
}

// A tab you are not looking at whose work just ended asks to be looked at, and
// keeps asking until you do. Looking at it, or it starting work again, clears.
function nextAttention({ attention = false, previous = 'none', current = 'none', active = false } = {}) {
  if (active) return false;
  if (current === 'working') return false;
  if (previous === 'working' && current === 'idle') return true;
  if (current === 'none') return false;
  return attention;
}

module.exports = { createActivityLog, tabActivity, nextAttention, QUIET_MS, ECHO_MS };
