// The tab bar. It draws what main says the tabs are and asks main for changes;
// it holds no state of its own beyond the last picture it was sent.
(function () {
  const api = window.tabsApi;
  const tabsEl = document.getElementById('tabs');
  document.body.dataset.platform = api.platform || '';

  // Mirrors applyThemeAttrs() in app.js and the inline script in index.html.
  const THEMES = ['operator', 'glass', 'graphite', 'soft', 'dusk'];
  function applyTheme(name) {
    const b = document.body;
    if (THEMES.includes(name)) b.dataset.theme = name; else delete b.dataset.theme;
    b.toggleAttribute('data-glass', name === 'glass' || name === 'graphite');
    b.toggleAttribute('data-soft', name === 'soft' || name === 'dusk');
  }

  let dragId = null;
  function render(state) {
    if (!state) return;
    applyTheme(state.theme);
    document.body.classList.toggle('is-fullscreen', !!state.fullscreen);
    tabsEl.textContent = '';
    for (const t of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.active ? ' active' : '');
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(!!t.active));
      el.title = t.title + (t.live ? ` — ${t.live} session${t.live === 1 ? '' : 's'} running` : '');
      el.draggable = true;
      if (t.live) { const dot = document.createElement('span'); dot.className = 'tab-live'; el.appendChild(dot); }
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = t.label;
      el.appendChild(label);
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = 'Close Tab';
      close.setAttribute('aria-label', 'Close ' + t.label);
      close.addEventListener('click', (e) => { e.stopPropagation(); api.close(t.id); });
      el.appendChild(close);
      el.addEventListener('mousedown', (e) => { if (e.button === 0) api.activate(t.id); });
      el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); api.close(t.id); } });
      el.addEventListener('dragstart', () => { dragId = t.id; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); });
      el.addEventListener('dragover', (e) => { if (dragId && dragId !== t.id) e.preventDefault(); });
      el.addEventListener('drop', (e) => { e.preventDefault(); if (dragId && dragId !== t.id) api.move(dragId, t.index); });
      tabsEl.appendChild(el);
    }
  }

  document.getElementById('new').addEventListener('click', () => api.newTab());
  api.onState(render);
  api.ready().then(render);
})();
