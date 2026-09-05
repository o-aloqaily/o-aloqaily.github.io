// app.js — keyboard + mouse controls for the terminal UI. ~5KB, no dependencies.
// Everything here is progressive enhancement: the site is fully usable without it.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const html = document.documentElement;
  html.classList.add('js');

  const page = document.body.dataset.page;
  const flashEl = $('#flash'), modeEl = $('#mode');
  const cmdForm = $('#cmdline'), cmdInput = $('#cmd');
  const help = $('#help'), search = $('#q');
  const visible = el => el.offsetParent !== null;

  let flashTimer;
  const flash = (msg, ms = 2000) => {
    flashEl.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashEl.textContent = ''; }, ms);
  };
  const setMode = m => { modeEl.textContent = m; modeEl.classList.toggle('cmd', m !== 'NORMAL'); };
  const go = href => { location.href = href; };

  // ---- theme ------------------------------------------------------------
  const currentTheme = () => html.dataset.theme || 'dark';
  const theme = next => {
    next = next || (currentTheme() === 'dark' ? 'light' : 'dark');
    html.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (_) {}
    $('meta[name=theme-color]').content = next === 'light' ? '#f2f0ea' : '#0b0e14';
    flash(`theme → ${next}`);
  };

  // ---- selection: keyboard focus IS the selection -------------------------
  const items = () => $$('[data-nav]').filter(visible);
  const move = delta => {
    if (page === 'post') { window.scrollBy({ top: delta * 80, behavior: 'auto' }); return; }
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const n = i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + delta));
    list[n].focus();
    list[n].scrollIntoView({ block: 'nearest' });
  };
  const posts = () => $$('.posts [data-nav]').filter(visible);
  const openNth = n => { const p = posts()[n - 1]; p ? p.click() : flash(`open: no post #${n}`); };
  const openSelected = () => {
    const a = document.activeElement;
    if (a && a.matches('[data-nav]')) a.click();
    else if (page === 'home') openNth(1);
  };

  // ---- actions (shared by keys, status bar buttons, help rows, :commands) --
  const links = Object.fromEntries($$('[data-cmd]').map(a => [a.dataset.cmd, a.href]));
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); flash('copied link to clipboard ✓'); }
    catch (_) { window.prompt('Copy this link:', location.href); }
  };
  const closeAll = () => {
    if (help.open) help.close();
    if (!cmdForm.hidden) { cmdForm.hidden = true; cmdInput.value = ''; setMode('NORMAL'); }
    if (search && search.value) { search.value = ''; filter(); }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  };
  const act = {
    down: () => move(1), up: () => move(-1), open: openSelected, open1: () => openNth(1),
    home: () => go('/'), top: () => window.scrollTo({ top: 0 }), bottom: () => window.scrollTo({ top: document.body.scrollHeight }),
    prev: () => { const a = $('[data-role=prev]') || $('link[rel=prev]'); a ? go(a.href) : flash('already at the newest post'); },
    next: () => { const a = $('[data-role=next]') || $('link[rel=next]'); a ? go(a.href) : flash('no older posts'); },
    search: () => { if (search) { search.focus(); search.select(); } else go('/#posts'); },
    cmd: () => { closeAll(); cmdForm.hidden = false; setMode('COMMAND'); cmdInput.focus(); },
    theme: () => theme(), copy, rss: () => go('/feed.xml'),
    help: () => { if (help.open) help.close(); else help.showModal(); },
    close: closeAll,
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.preventDefault();
    if (help.open && b.closest('#help')) help.close();
    act[b.dataset.act]?.();
  });
  help.addEventListener('click', e => { if (e.target === help) help.close(); }); // backdrop click

  // ---- search (home): `ls -lt ~/posts | grep …` -------------------------
  const filter = () => {
    if (!search) return;
    const s = search.value.trim().toLowerCase();
    let n = 0;
    $$('.posts li[data-search]').forEach(li => { const hit = !s || li.dataset.search.includes(s); li.hidden = !hit; n += hit; });
    $('.posts .empty').hidden = n > 0;
  };
  if (search) {
    search.addEventListener('input', filter);
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); openNth(1); }
      else if (e.key === 'Escape') { search.value = ''; filter(); search.blur(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); search.blur(); move(1); }
    });
    if (location.hash === '#posts') search.focus();
  }

  // ---- command line: `:` -------------------------------------------------
  const commands = {
    help: act.help, h: act.help, home: act.home, posts: () => go('/#posts'), ls: () => go('/#posts'),
    open: n => openNth(Number(n) || 1), o: n => openNth(Number(n) || 1),
    theme: t => theme(['dark', 'light'].includes(t) ? t : undefined), copy: act.copy, rss: act.rss,
    top: act.top, bottom: act.bottom, prev: act.prev, next: act.next,
    q: closeAll, quit: closeAll, clear: () => flash(''),
    whoami: () => flash('you are a guest. welcome.'), pwd: () => flash(location.pathname),
    sudo: () => flash('permission denied: nice try 🙂'),
    ...Object.fromEntries(Object.keys(links).map(k => [k, () => go(links[k])])),
  };
  const runCommand = () => {
    const [name, ...args] = cmdInput.value.trim().split(/\s+/);
    cmdForm.hidden = true; cmdInput.value = ''; setMode('NORMAL');
    if (!name) return;
    const fn = commands[name.toLowerCase()];
    fn ? fn(...args) : flash(`bash: ${name}: command not found (try :help)`, 3000);
  };
  cmdForm.addEventListener('submit', e => { e.preventDefault(); runCommand(); });
  cmdInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeAll(); }
    if (e.key === 'Enter') { e.preventDefault(); runCommand(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const v = cmdInput.value.toLowerCase();
      const m = Object.keys(commands).filter(c => c.startsWith(v) && c.length > 1);
      if (m.length === 1) cmdInput.value = m[0] + ' ';
      else if (m.length) flash(m.join('  '), 4000);
    }
  });

  // ---- keys --------------------------------------------------------------
  let pending = '', pendingTimer;
  const keys = {
    j: act.down, ArrowDown: act.down, k: act.up, ArrowUp: act.up,
    h: act.home, '[': act.prev, ArrowLeft: act.prev, ']': act.next, ArrowRight: act.next,
    G: act.bottom, '/': act.search, ':': act.cmd, t: act.theme, c: act.copy, r: act.rss, '?': act.help,
    d: () => window.scrollBy({ top: innerHeight / 2 }), u: () => window.scrollBy({ top: -innerHeight / 2 }),
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeAll(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.matches('input, textarea, select, [contenteditable]')) return;
    if (help.open) { if (e.key === '?') { e.preventDefault(); help.close(); } return; }

    if (pending === 'g') {
      clearTimeout(pendingTimer); pending = '';
      if (e.key === 'g') { e.preventDefault(); act.top(); return; }
      if (e.key === 'h') { e.preventDefault(); act.home(); return; }
    }
    if (e.key === 'g') { pending = 'g'; pendingTimer = setTimeout(() => { pending = ''; }, 700); return; }
    if (/^[1-9]$/.test(e.key) && page === 'home') { e.preventDefault(); openNth(Number(e.key)); return; }
    if (e.key === 'Enter' && page === 'home' && !(t.matches('a, button'))) { e.preventDefault(); openSelected(); return; }
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });

  // Small welcome for keyboard folks; harmless for everyone else.
  flash('press ? for keys', 3500);
})();
