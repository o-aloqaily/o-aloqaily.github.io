// app.js — the interactive shell. Zero dependencies. Progressive enhancement:
// every page is a complete pre-rendered transcript; this script makes the prompt live.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const html = document.documentElement;
  html.classList.add('js');
  const FS = JSON.parse($('#fs').textContent);
  const out = $('#out'), form = $('#prompt'), input = $('#in'), typed = $('#typed'), ps1 = $('#ps1'), cursorEl = $('#cursor');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const run = (cmd, label = cmd) => `<button type="button" class="run" data-cmd="${esc(cmd)}">${esc(label)}</button>`;
  const dim = s => `<span class="dim">${s}</span>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- virtual filesystem ----------------------------------------------
  let cwd = '~';
  const ROOTFILES = ['about.txt', 'links.txt'];
  const postByFile = f => FS.posts.find(p => p.file === f || p.slug === f || p.file === f + '.md');
  const dirOf = d => d === '~' ? { dirs: ['posts'], files: ROOTFILES } : d === '~/posts' ? { dirs: [], files: FS.posts.map(p => p.file) } : null;
  // Resolve a typed path (absolute, relative, ~, .., prefixes, missing .md) to {type, dir, name, post}.
  function resolve(arg) {
    if (!arg) return { type: 'dir', dir: cwd };
    let parts = (arg.startsWith('~') || arg.startsWith('/') ? [] : cwd.split('/')).concat(arg.replace(/^~/, '').split('/'));
    const stack = [];
    for (const p of parts) {
      if (p === '' || p === '.' || p === '~') continue;
      if (p === '..') { stack.pop(); continue; }
      stack.push(p);
    }
    if (stack.length === 0) return { type: 'dir', dir: '~' };
    if (stack.length === 1 && stack[0] === 'posts') return { type: 'dir', dir: '~/posts' };
    if (stack.length === 1) {
      const n = stack[0];
      const f = ROOTFILES.find(x => x === n || x === n + '.txt');
      if (f) return { type: 'file', name: f };
      const post = postByFile(n) || FS.posts.find(p => p.slug.startsWith(n));
      if (post) return { type: 'file', name: post.file, post };
      return { type: 'missing', name: n };
    }
    if (stack.length === 2 && stack[0] === 'posts') {
      const post = postByFile(stack[1]) || FS.posts.find(p => p.slug.startsWith(stack[1]));
      return post ? { type: 'file', name: post.file, post } : { type: 'missing', name: arg };
    }
    return { type: 'missing', name: arg };
  }

  // ---- output helpers ------------------------------------------------------
  const ps1Html = d => `<span class="ps1"><span class="u">${esc(FS.user)}@${esc(FS.host)}</span>:<span class="p">${esc(d)}</span>$</span>`;
  function echo(cmd) {
    const e = document.createElement('div'); e.className = 'e';
    e.innerHTML = `<div class="c">${ps1Html(cwd)} <span class="t">${esc(cmd)}</span></div><div class="o"></div>`;
    out.appendChild(e);
    return e;
  }
  function scrollFor(e) {
    const top = e.getBoundingClientRect().top + scrollY;
    if (e.offsetHeight > innerHeight * 0.8) scrollTo({ top: top - 8 }); else scrollTo({ top: document.body.scrollHeight });
  }
  const setCwd = d => { cwd = d; ps1.querySelector('.p').textContent = d; };
  const closeSession = () => { document.body.classList.add('closed'); };

  // ---- commands ------------------------------------------------------------
  const lsOut = d => {
    const { dirs, files } = dirOf(d);
    if (d === '~/posts') return `<ul class="ls files">${FS.posts.map(p => `<li><a class="file run" data-cmd="cat posts/${esc(p.file)}" href="${esc(p.url)}">${esc(p.file)}</a>${dim(esc(p.date) + ' · ' + esc(p.title))}</li>`).join('')}</ul>`;
    return dirs.map(x => `<span class="dir">${run('ls ' + x, x + '/')}</span>`).concat(files.map(f => run('cat ' + f, f))).join('  ');
  };
  const aboutOut = () => `<div class="who"><img class="avatar" src="${esc(FS.photo)}" srcset="${esc(FS.photo)} 1x, ${esc(FS.photo2x)} 2x" width="96" height="96" alt="Photo of ${esc(FS.name)}"><div><b class="name">${esc(FS.name)}</b>\n${esc(FS.tagline)}\n\n${dim('Find me:')} ${run('cat links.txt')}   ${dim('Read:')} ${run('ls posts')}</div></div>`;
  const linksOut = () => `<ul class="ls links">${FS.links.map(l => `<li><span class="k">${esc(l.key)}</span><a href="${esc(l.href)}" rel="me noopener" target="_blank">${esc(l.label)}</a></li>`).join('')}</ul>`;
  const HELP = [
    ['help', 'this list'], ['ls [dir]', 'list files  — try ' + run('ls posts')], ['cat <file>', 'read a file — try ' + run('cat about.txt')],
    ['cd <dir>', 'change directory (cd posts, cd ..)'], ['open <n>', 'open the n-th post'], ['share', 'share the page you are reading'],
    ['links', 'social links (also: github, twitter, linkedin, email)'], ['theme [dark|light]', 'switch colours'],
    ['clear', 'clear the screen (ctrl+l)'], ['neofetch, whoami, date, history, exit', 'the usual suspects'],
  ];
  const helpOut = () => `<div class="help">${HELP.map(([c, d]) => `<span>${run(c.split(' ')[0], c)}</span><span class="dim">${d}</span>`).join('')}</div>\n${dim('keys: <kbd>tab</kbd> completes · <kbd>↑</kbd>/<kbd>↓</kbd> history · <kbd>ctrl+c</kbd> cancels · <kbd>ctrl+l</kbd> clears. Everything underlined is clickable.')}`;
  const currentPost = () => { const m = location.pathname.match(/^\/posts\/([^/]+)\/?$/); return m && FS.posts.find(p => p.slug === m[1]); };
  const shareOut = () => {
    const p = currentPost();
    const url = FS.url + (p ? p.url : '/');
    const text = encodeURIComponent(p ? p.title + (FS.links.find(l => l.key === 'twitter')?.handle ? ' by ' + FS.links.find(l => l.key === 'twitter').handle : '') : FS.name);
    return `${dim(p ? 'share ' + p.file : 'share this site')}\n  ${run('copy', 'copy link')}   <a href="https://x.com/intent/post?text=${text}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">post on X</a>   <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">share on LinkedIn</a>\n  ${dim(esc(url))}`;
  };
  const fetchOut = () => `<div class="fetch"><pre class="banner" aria-hidden="true">${esc(FS.banner || '')}</pre><div><b>${esc(FS.user)}@${esc(FS.host)}</b>\n${'-'.repeat(FS.user.length + FS.host.length + 1)}\n<span class="k">OS</span>: static HTML, hand-built\n<span class="k">Host</span>: GitHub Pages\n<span class="k">Kernel</span>: build.mjs (marked + highlight.js at build time only)\n<span class="k">Shell</span>: app.js, zero dependencies\n<span class="k">Uptime</span>: since ${esc(FS.posts[FS.posts.length - 1]?.date || '2020')}\n<span class="k">Packages</span>: ${FS.posts.length} post${FS.posts.length === 1 ? '' : 's'}\n<span class="k">Theme</span>: ${html.dataset.theme || 'dark'}\n<span class="k">Trackers</span>: none</div></div>`;

  const bodyCache = {};
  async function catPost(post, e, push) {
    const o = e.querySelector('.o');
    if (!bodyCache[post.slug]) {
      o.innerHTML = dim('loading ' + esc(post.file) + ' …');
      try { bodyCache[post.slug] = await (await fetch(post.url + 'body.html')).text(); }
      catch { o.innerHTML = `<span class="err">cat: ${esc(post.file)}: could not load (offline?)</span>`; return; }
    }
    o.innerHTML = bodyCache[post.slug];
    if (push) history.pushState({ post: post.slug }, '', post.url);
    document.title = `${post.title} — ${FS.name}`;
  }
  const notFound = (cmd, name) => `<span class="err">${esc(cmd)}: ${esc(name)}: No such file or directory</span>\n${dim('try')} ${run('ls')} ${dim('to see what is here')}`;

  const commands = {
    help: () => helpOut(), man: a => helpOut(), '?': () => helpOut(),
    ls: (a, e, args) => { const r = resolve(args.filter(x => !x.startsWith('-'))[0]); if (r.type === 'dir') return lsOut(r.dir); if (r.type === 'file') return run('cat ' + r.name, r.name); return notFound('ls', r.name); },
    dir: (...a) => commands.ls(...a), ll: (...a) => commands.ls(...a),
    cat: async (a, e) => {
      if (!a) return `cat: missing file — try ${run('cat about.txt')} or ${run('ls posts')}`;
      const r = resolve(a);
      if (r.type === 'dir') return `cat: ${esc(a)}: Is a directory — try ${run('ls ' + (r.dir === '~' ? '' : 'posts'))}`;
      if (r.type === 'missing') return notFound('cat', a);
      if (r.name === 'about.txt') return aboutOut();
      if (r.name === 'links.txt') return linksOut();
      await catPost(r.post, e, true); return null;
    },
    less: (a, e) => commands.cat(a, e), more: (a, e) => commands.cat(a, e), open: (a, e) => {
      const n = Number(a); const p = n ? FS.posts[n - 1] : (a ? resolve(a).post : FS.posts[0]);
      return p ? commands.cat('posts/' + p.file, e) : `open: no post #${esc(a)} — ${run('ls posts')}`;
    },
    cd: a => { const r = resolve(a || '~'); if (r.type === 'dir') { setCwd(r.dir); return ''; } return r.type === 'file' ? `cd: ${esc(a)}: Not a directory — try ${run('cat ' + r.name)}` : notFound('cd', a); },
    pwd: () => esc(cwd.replace('~', '/home/' + FS.user)),
    whoami: () => esc(FS.user), hostname: () => esc(FS.host), id: () => `uid=1000(${esc(FS.user)}) gid=1000(visitors)`,
    date: () => new Date().toString(), uptime: () => `up since ${esc(FS.posts[FS.posts.length - 1]?.date || '2020')}, ${FS.posts.length} post(s), load average: 0.00 0.00 0.00`,
    uname: () => `${esc(FS.host)} 2.0.0 static-html #1 zero-deps x86_64 GNU/Linux`,
    echo: a => esc(a), true: () => '', ':': () => '',
    clear: () => { out.innerHTML = ''; return null; }, cls: () => commands.clear(),
    history: () => hist.map((h, i) => `${String(i + 1).padStart(4)}  ${run(h)}`).join('\n') || dim('(empty)'),
    neofetch: () => fetchOut(), screenfetch: () => fetchOut(),
    share: () => shareOut(), copy: async () => { const u = location.href; try { await navigator.clipboard.writeText(u); return `copied ${esc(u)} to clipboard ✓`; } catch { return `copy this: ${esc(u)}`; } },
    links: () => linksOut(), contact: () => linksOut(), about: () => aboutOut(), posts: () => lsOut('~/posts'), blog: () => lsOut('~/posts'),
    rss: () => { open('/feed.xml', '_blank'); return `opening <a href="/feed.xml">/feed.xml</a>`; },
    theme: a => { const next = ['dark', 'light'].includes(a) ? a : (html.dataset.theme === 'light' ? 'dark' : 'light'); html.dataset.theme = next; try { localStorage.setItem('theme', next); } catch {} return `theme → ${next}`; },
    exit: () => { closeSession(); return `logout\nConnection to ${esc(FS.host)} closed.\n${run('reconnect', 'ssh ' + FS.user + '@' + FS.host)} ${dim('to reconnect')}`; },
    logout: () => commands.exit(), quit: () => commands.exit(),
    reconnect: () => { document.body.classList.remove('closed'); input.focus(); return `Connected to ${esc(FS.host)}. Welcome back.`; }, ssh: () => `already connected to ${esc(FS.host)} — you are ${esc(FS.user)}.`,
    sudo: () => `${esc(FS.user)} is not in the sudoers file. This incident will be reported. 🙂`, su: () => 'su: Authentication failure',
    rm: () => `rm: read-only file system (it's a static site)`, mv: () => 'mv: read-only file system', touch: () => 'touch: read-only file system', mkdir: () => 'mkdir: read-only file system',
    vim: a => `vim: ${esc(a || 'file')} is read-only here — but you can ${run('cat ' + (a || 'about.txt'))}`, vi: a => commands.vim(a), nano: a => commands.vim(a), emacs: a => commands.vim(a),
    ping: a => `PONG ${esc(a || FS.host)}: 64 bytes, time=0.042 ms (static sites are fast)`, curl: a => `curl: try ${run('cat ' + (a || 'about.txt'))} instead`,
    top: () => 'Tasks: 1 total, 1 running (you). CPU: 0% — nothing to do, it is all static HTML.', htop: () => commands.top(),
    ...Object.fromEntries(FS.links.map(l => [l.key, () => { open(l.href, '_blank', 'noopener'); return `opening <a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`; }])),
  };
  if (FS.links.some(l => l.key === 'twitter')) commands.x = commands.twitter;

  const hist = []; let histIdx = 0;
  async function exec(line, { push = true } = {}) {
    line = line.trim();
    const e = echo(line);
    if (!line) { scrollFor(e); return; }
    if (hist[hist.length - 1] !== line) hist.push(line); histIdx = hist.length;
    const [name, ...args] = line.split(/\s+/);
    const fn = commands[name.toLowerCase()];
    const o = e.querySelector('.o');
    try {
      const r = fn ? await fn(args.join(' '), e, args) : `<span class="err">${esc(name)}: command not found</span>\n${dim('type')} ${run('help')} ${dim('to see what you can do')}`;
      if (r !== null && r !== undefined) o.innerHTML = r;
    } catch (err) { o.innerHTML = `<span class="err">${esc(name)}: ${esc(err.message)}</span>`; }
    scrollFor(e);
  }

  // ---- prompt / input ------------------------------------------------------
  const mirror = () => { const v = input.value, i = input.selectionStart ?? v.length; typed.textContent = v.slice(0, i); cursorEl.dataset.rest = v.slice(i); cursorEl.textContent = v.slice(i, i + 1) || ''; cursorEl.nextSibling?.nodeType === 3 && cursorEl.nextSibling.remove(); if (v.slice(i + 1)) cursorEl.after(document.createTextNode(v.slice(i + 1))); };
  ['input', 'keyup', 'click', 'select'].forEach(ev => input.addEventListener(ev, mirror));
  input.addEventListener('focus', () => form.classList.remove('blur'));
  input.addEventListener('blur', () => form.classList.add('blur'));
  form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; mirror(); exec(v); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (histIdx > 0) { histIdx--; input.value = hist[histIdx]; setTimeout(mirror); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); histIdx = Math.min(hist.length, histIdx + 1); input.value = hist[histIdx] || ''; setTimeout(mirror); return; }
    if (e.key === 'Tab') { e.preventDefault(); complete(); return; }
    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); commands.clear(); return; }
    if (e.ctrlKey && e.key === 'c') { e.preventDefault(); const ee = echo(input.value + '^C'); input.value = ''; mirror(); scrollFor(ee); return; }
    if (e.ctrlKey && e.key === 'u') { e.preventDefault(); input.value = ''; mirror(); }
  });
  function complete() {
    const v = input.value, words = v.split(/\s+/), last = words[words.length - 1];
    let cands;
    if (words.length === 1) cands = Object.keys(commands).filter(c => c.startsWith(last) && !c.includes(' '));
    else {
      const slash = last.lastIndexOf('/'), base = last.slice(0, slash + 1), part = last.slice(slash + 1);
      const r = resolve(base || undefined);
      const d = r.type === 'dir' ? dirOf(r.dir) : null;
      cands = d ? d.dirs.map(x => base + x + '/').concat(d.files.map(f => base + f)).filter(x => x.startsWith(last)) : [];
    }
    if (cands.length === 1) { words[words.length - 1] = cands[0] + (cands[0].endsWith('/') ? '' : ' '); input.value = words.join(' '); mirror(); }
    else if (cands.length > 1) {
      const common = cands.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
      if (common.length > last.length) { words[words.length - 1] = common; input.value = words.join(' '); mirror(); }
      else { const e = echo(v); e.querySelector('.o').innerHTML = cands.map(c => run(words.slice(0, -1).concat(c).join(' '), c)).join('  '); scrollFor(e); }
    }
  }
  // Click anywhere that is not a link/button/selection → focus the prompt. Click a .run → type + run it.
  document.addEventListener('click', e => {
    const r = e.target.closest('.run');
    if (r) { e.preventDefault(); input.value = ''; mirror(); exec(r.dataset.cmd); input.focus({ preventScroll: true }); return; }
    if (e.target.closest('a, button, input, video, img, pre')) return;
    if (getSelection().toString()) return;
    input.focus({ preventScroll: true });
  });
  addEventListener('popstate', () => { const p = currentPost(); if (p) { const e = echo('cat posts/' + p.file); catPost(p, e, false).then(() => scrollFor(e)); } });

  // ---- boot: replay the ssh connection once per session on the home page -----
  const boot = $('#boot');
  const motdEntry = $('#motd-entry');
  let played = false; try { played = sessionStorage.getItem('ssh') === '1'; } catch {}
  const finish = () => { try { sessionStorage.setItem('ssh', '1'); } catch {} input.focus({ preventScroll: true }); };
  if (boot && motdEntry && !played && !reduced) {
    const cmdEl = $('#ssh-cmd'), full = cmdEl.textContent, sshOut = $('#ssh-out');
    cmdEl.textContent = ''; motdEntry.classList.add('hidden'); form.classList.add('hidden'); $('.chips')?.classList.add('hidden');
    let i = 0, done = false;
    const skip = () => { if (done) return; done = true; cmdEl.textContent = full; sshOut.innerHTML = ''; motdEntry.classList.remove('hidden'); form.classList.remove('hidden'); $('.chips')?.classList.remove('hidden'); finish(); };
    const type = () => { if (done) return; if (i < full.length) { cmdEl.textContent += full[i++]; setTimeout(type, 28 + Math.random() * 40); } else { sshOut.innerHTML = dim(`Connecting to ${esc(FS.host)}…`); setTimeout(() => { if (done) return; sshOut.innerHTML += `\n${dim('Authenticated as ' + esc(FS.user) + ' (public key). ')}`; setTimeout(skip, 220); }, 260); } };
    setTimeout(type, 200);
    addEventListener('keydown', skip, { once: true }); addEventListener('pointerdown', skip, { once: true });
  } else finish();
  mirror();
})();
