// build.mjs — turns content/ + static/ + src/ into dist/.
// The generated site has zero runtime dependencies: plain HTML, one inlined
// stylesheet, one small deferred script. `marked` and `highlight.js` are only
// used here, at build time.
//
//   node build.mjs           build once
//   node build.mjs --serve   build, watch, and serve dist/ on http://localhost:8080

import fs from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { marked } from 'marked';
import hljs from 'highlight.js';

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, 'dist');
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const argv = new Set(process.argv.slice(2));

// ---------------------------------------------------------------- helpers
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const abs = p => new URL(p, cfg.url).href;
const PS1 = `<span class="ps1"><span class="u">${esc(cfg.prompt.user)}</span>@<span class="h">${esc(cfg.prompt.host)}</span>:<span class="p">~</span>$</span>`;

function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  let key = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const list = raw.match(/^\s+-\s+(.*)$/);
    if (list && key) { (data[key] = Array.isArray(data[key]) ? data[key] : []).push(list[1].trim()); continue; }
    const kv = raw.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    let v = kv[2].trim();
    if (v === '') { data[key] = []; continue; }
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else v = v.replace(/^["']|["']$/g, '');
    data[key] = v;
  }
  return { data, body: src.slice(m[0].length) };
}

// Reads width/height straight from PNG / JPEG / WebP headers so every <img>
// gets explicit dimensions (no layout shift) without any image library.
function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const t = buf.toString('ascii', 12, 16);
    if (t === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    if (t === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
const sizeCache = new Map();
async function staticSize(href) {
  if (!href.startsWith('/')) return null;
  if (sizeCache.has(href)) return sizeCache.get(href);
  const file = path.join(ROOT, 'static', href);
  let s = null;
  if (existsSync(file)) s = imageSize(await fs.readFile(file));
  sizeCache.set(href, s);
  return s;
}
const dim = s => s ? ` width="${s.w}" height="${s.h}"` : '';

// ---------------------------------------------------------------- markdown
let assetsInDoc = [];
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = slugify(text.replace(/<[^>]+>/g, ''));
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
    },
    code({ text, lang }) {
      const l = (lang || '').trim().split(/\s+/)[0];
      const known = l && hljs.getLanguage(l);
      const body = known ? hljs.highlight(text, { language: l }).value : esc(text);
      return `<pre data-lang="${esc(l || 'text')}"><code class="hljs${known ? ' language-' + esc(l) : ''}">${body}</code></pre>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const ext = /^https?:\/\//.test(href) && !href.startsWith(cfg.url);
      return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' rel="noopener"' : ''}>${text}</a>`;
    },
    image({ href, title, text }) {
      assetsInDoc.push(href);
      const cap = title ? `<figcaption>${esc(title.trim())}</figcaption>` : '';
      if (href.endsWith('.mp4')) {
        // Animated GIFs are shipped as tiny muted MP4s with a WebP poster.
        const poster = href.replace(/\.mp4$/, '.webp');
        return `<figure><video src="${esc(href)}" poster="${esc(poster)}"${dim(sizeCache.get(poster))} autoplay loop muted playsinline preload="metadata" aria-label="${esc(text)}"></video>${cap}</figure>`;
      }
      return `<figure><img src="${esc(href)}" alt="${esc(text)}"${dim(sizeCache.get(href))} loading="lazy" decoding="async">${cap}</figure>`;
    },
  },
});

async function renderMarkdown(md) {
  // Pre-warm the size cache for every image referenced so the sync renderer can use it.
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    await staticSize(m[1]);
    if (m[1].endsWith('.mp4')) await staticSize(m[1].replace(/\.mp4$/, '.webp'));
  }
  assetsInDoc = [];
  return marked.parse(md);
}

// ---------------------------------------------------------------- content
async function loadPosts() {
  const dir = path.join(ROOT, 'content', 'posts');
  const posts = [];
  for (const f of (await fs.readdir(dir)).filter(f => f.endsWith('.md')).sort()) {
    const src = await fs.readFile(path.join(dir, f), 'utf8');
    const { data, body } = frontmatter(src);
    if (data.draft === true) continue;
    const slug = data.slug || slugify(f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''));
    const date = data.date || f.slice(0, 10);
    const words = body.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
    posts.push({
      slug, date, file: f,
      title: data.title || slug,
      description: data.description || '',
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
      image: data.image || null,
      minutes: Math.max(1, Math.round(words / 220)),
      url: `/posts/${slug}/`,
      html: await renderMarkdown(body),
    });
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  posts.forEach((p, i) => { p.newer = posts[i - 1] || null; p.older = posts[i + 1] || null; });
  return posts;
}

// ---------------------------------------------------------------- templates
const css = await fs.readFile(path.join(ROOT, 'src', 'style.css'), 'utf8');

const linksList = (cls = '') => `<ul class="ls links ${cls}">${cfg.links.map((l, i) => `
  <li><a data-nav data-cmd="${esc(l.key)}" href="${esc(l.href)}" rel="me noopener"><span class="k">${esc(l.key)}</span><span class="arrow" aria-hidden="true">→</span><span class="v">${esc(l.label)}</span></a></li>`).join('')}
</ul>`;

function layout({ title, description, url, image, body, page, cwd, prev, next }) {
  const fullTitle = page === 'home' ? `${cfg.title} — ${cfg.tagline}` : `${title} — ${cfg.title}`;
  const ogImage = abs(image || cfg.author.social || cfg.author.photo2x);
  const tw = cfg.links.find(l => l.key === 'twitter');
  return `<!doctype html>
<html lang="${esc(cfg.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(url))}">
<meta name="author" content="${esc(cfg.author.name)}">
<meta name="theme-color" content="#0b0e14">
<meta property="og:type" content="${page === 'post' ? 'article' : 'website'}">
<meta property="og:site_name" content="${esc(cfg.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(url))}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
${tw ? `<meta name="twitter:site" content="${esc(tw.handle)}">\n<meta name="twitter:creator" content="${esc(tw.handle)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.title)}" href="/feed.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${prev ? `<link rel="prev" href="${esc(prev)}">` : ''}${next ? `<link rel="next" href="${esc(next)}">` : ''}
<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${css}</style>
</head>
<body data-page="${page}">
<a class="skip" href="#main">skip to content</a>
<div class="term">
  <header class="bar" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span><span class="bar-title">${esc(cfg.prompt.user)}@${esc(cfg.prompt.host)}: ${esc(cwd)}</span></header>
  <main id="main">
${body}
  </main>
  <footer class="foot">
    <p class="line">${PS1} <span class="cmd">echo $LINKS</span></p>
    <p class="inline-links">${cfg.links.map(l => `<a data-cmd="${esc(l.key)}" href="${esc(l.href)}" rel="me noopener">${esc(l.key)}</a>`).join(' <span class="dim">·</span> ')} <span class="dim">·</span> <a data-cmd="rss" href="/feed.xml">rss</a></p>
    <p class="dim small">© ${new Date().getFullYear()} ${esc(cfg.author.name)}. Hand-built static HTML, no trackers, no frameworks.</p>
  </footer>
</div>

<div class="status js-only" id="status" role="toolbar" aria-label="site controls">
  <span class="status-left"><span class="mode" id="mode">NORMAL</span><span class="path">${esc(cwd)}</span><span class="flash" id="flash" role="status" aria-live="polite"></span></span>
  <span class="status-right">
    ${page === 'home' ? '<button type="button" data-act="search" title="Search posts (/)"><kbd>/</kbd> search</button>' : ''}
    <button type="button" data-act="cmd" title="Command line (:)"><kbd>:</kbd> cmd</button>
    <button type="button" data-act="theme" title="Toggle theme (t)"><kbd>t</kbd> theme</button>
    <button type="button" data-act="help" title="Keyboard shortcuts (?)"><kbd>?</kbd> help</button>
  </span>
  <form class="cmdline" id="cmdline" hidden autocomplete="off"><label for="cmd">:</label><input id="cmd" type="text" spellcheck="false" placeholder="type a command, tab to complete, esc to close"></form>
</div>

<dialog id="help" aria-labelledby="help-title">
  <p class="line"><span class="ps1"><span class="u">${esc(cfg.prompt.user)}</span>@<span class="h">${esc(cfg.prompt.host)}</span>:<span class="p">~</span>$</span> <span class="cmd">man keys</span></p>
  <h2 id="help-title" class="visually-hidden">Keyboard shortcuts</h2>
  <p class="dim small">Every row is clickable, too. Press <kbd>esc</kbd> or click outside to close.</p>
  <div class="keys">
    <section><h3>navigate</h3>
      <button type="button" data-act="down"><kbd>j</kbd><kbd>↓</kbd><span>next item / scroll down</span></button>
      <button type="button" data-act="up"><kbd>k</kbd><kbd>↑</kbd><span>previous item / scroll up</span></button>
      <button type="button" data-act="open"><kbd>enter</kbd><span>open selected</span></button>
      <button type="button" data-act="open1"><kbd>1</kbd>…<kbd>9</kbd><span>open n-th post</span></button>
      <button type="button" data-act="home"><kbd>h</kbd><span>home</span></button>
      <button type="button" data-act="prev"><kbd>[</kbd><kbd>←</kbd><span>newer post</span></button>
      <button type="button" data-act="next"><kbd>]</kbd><kbd>→</kbd><span>older post</span></button>
      <button type="button" data-act="top"><kbd>g</kbd><kbd>g</kbd><span>top of page</span></button>
      <button type="button" data-act="bottom"><kbd>G</kbd><span>bottom of page</span></button>
    </section>
    <section><h3>do</h3>
      <button type="button" data-act="search"><kbd>/</kbd><span>search posts</span></button>
      <button type="button" data-act="cmd"><kbd>:</kbd><span>command line</span></button>
      <button type="button" data-act="theme"><kbd>t</kbd><span>toggle dark / light</span></button>
      <button type="button" data-act="copy"><kbd>c</kbd><span>copy link to this page</span></button>
      <button type="button" data-act="rss"><kbd>r</kbd><span>rss feed</span></button>
      <button type="button" data-act="help"><kbd>?</kbd><span>this help</span></button>
      <button type="button" data-act="close"><kbd>esc</kbd><span>close / clear</span></button>
    </section>
  </div>
  <p class="dim small">Commands for <kbd>:</kbd> — home, posts, open &lt;n&gt;, ${cfg.links.map(l => esc(l.key)).join(', ')}, rss, theme [dark|light], copy, top, help, quit.</p>
</dialog>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

function homeBody(posts) {
  return `
<section class="block" aria-labelledby="whoami">
  <p class="line" id="whoami">${PS1} <span class="cmd">whoami</span></p>
  <div class="who">
    <img class="avatar" src="${esc(cfg.author.photo)}" srcset="${esc(cfg.author.photo)} 1x, ${esc(cfg.author.photo2x)} 2x" width="96" height="96" alt="Photo of ${esc(cfg.author.name)}" fetchpriority="high">
    <div>
      <h1>${esc(cfg.author.name)}</h1>
      <p class="tagline">${esc(cfg.tagline)}</p>
    </div>
  </div>
</section>

<section class="block" aria-labelledby="links-cmd">
  <p class="line" id="links-cmd">${PS1} <span class="cmd">ls ~/links</span></p>
  ${linksList()}
</section>

<section class="block" aria-labelledby="posts-cmd" id="posts">
  <p class="line" id="posts-cmd">${PS1} <span class="cmd">ls -lt ~/posts</span><span class="grep js-only"> | grep <input id="q" type="search" aria-label="Search posts" placeholder="…" autocomplete="off" spellcheck="false"></span></p>
  <ol class="ls posts">${posts.map((p, i) => `
    <li data-search="${esc([p.title, p.description, p.tags.join(' ')].join(' ').toLowerCase())}"><a data-nav href="${esc(p.url)}"><span class="n" aria-hidden="true">${i + 1}</span><time class="date" datetime="${esc(p.date)}">${esc(p.date)}</time><span class="name">${esc(p.title)}</span><span class="meta">${p.tags.slice(0, 2).map(t => '#' + esc(t)).join(' ')} · ${p.minutes} min</span></a></li>`).join('')}
    <li class="empty" hidden><span class="dim">grep: no matches</span></li>
  </ol>
</section>

<p class="line prompt-idle" aria-hidden="true">${PS1} <span class="cursor"></span></p>
`;
}

function postBody(p) {
  const tw = cfg.links.find(l => l.key === 'twitter');
  const shareText = encodeURIComponent(`${p.title}${tw ? ' by ' + tw.handle : ''}`);
  const shareUrl = encodeURIComponent(abs(p.url));
  return `
<p class="line">${PS1} <span class="cmd">cat ~/posts/${esc(p.slug)}.md</span></p>
<article class="post">
  <header class="post-head">
    <h1>${esc(p.title)}</h1>
    <p class="meta"><time datetime="${esc(p.date)}">${esc(p.date)}</time> <span class="dim">·</span> ${p.minutes} min read <span class="dim">·</span> ${p.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join(' ')}</p>
  </header>
  <div class="prose">
${p.html}
  </div>
</article>

<section class="block share" aria-labelledby="share-cmd">
  <p class="line" id="share-cmd">${PS1} <span class="cmd">share</span></p>
  <ul class="ls">
    <li><button type="button" data-nav data-act="copy"><span class="k">copy</span><span class="arrow" aria-hidden="true">→</span><span class="v">copy link to clipboard</span></button></li>
    <li><a data-nav href="https://x.com/intent/post?text=${shareText}&url=${shareUrl}" rel="noopener"><span class="k">x</span><span class="arrow" aria-hidden="true">→</span><span class="v">post on X / Twitter</span></a></li>
    <li><a data-nav href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" rel="noopener"><span class="k">linkedin</span><span class="arrow" aria-hidden="true">→</span><span class="v">share on LinkedIn</span></a></li>
  </ul>
</section>

<nav class="pn" aria-label="post navigation">
  ${p.newer ? `<a data-nav data-role="prev" href="${esc(p.newer.url)}"><span class="dim">← newer</span><br>${esc(p.newer.title)}</a>` : '<span></span>'}
  <a data-nav href="/" class="pn-home"><span class="dim">~</span><br>home</a>
  ${p.older ? `<a data-nav data-role="next" href="${esc(p.older.url)}" class="pn-right"><span class="dim">older →</span><br>${esc(p.older.title)}</a>` : '<span></span>'}
</nav>
`;
}

const notFoundBody = () => `
<p class="line">${PS1} <span class="cmd">cat <span id="nf-path">that/page</span></span></p>
<pre class="err">cat: no such file or directory (404)</pre>
<p class="line">${PS1} <span class="cmd">cd ~</span></p>
<ul class="ls"><li><a data-nav href="/"><span class="k">home</span><span class="arrow" aria-hidden="true">→</span><span class="v">back to the start</span></a></li></ul>
<script>document.getElementById('nf-path').textContent=location.pathname</script>
`;

const feed = posts => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${esc(cfg.title)}</title>
<link>${esc(cfg.url)}/</link>
<atom:link href="${esc(abs('/feed.xml'))}" rel="self" type="application/rss+xml"/>
<description>${esc(cfg.description)}</description>
<language>${esc(cfg.language)}</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${posts.map(p => `<item>
<title>${esc(p.title)}</title>
<link>${esc(abs(p.url))}</link>
<guid isPermaLink="true">${esc(abs(p.url))}</guid>
<pubDate>${new Date(p.date + 'T12:00:00Z').toUTCString()}</pubDate>
<description>${esc(p.description)}</description>
${p.tags.map(t => `<category>${esc(t)}</category>`).join('')}
<content:encoded><![CDATA[${p.html.replace(/(src|href)="\//g, `$1="${cfg.url}/`)}]]></content:encoded>
</item>`).join('\n')}
</channel>
</rss>
`;

const sitemap = posts => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${esc(cfg.url)}/</loc></url>
${posts.map(p => `<url><loc>${esc(abs(p.url))}</loc><lastmod>${esc(p.date)}</lastmod></url>`).join('\n')}
</urlset>
`;

// ---------------------------------------------------------------- build
async function build() {
  const t0 = performance.now();
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  await fs.cp(path.join(ROOT, 'static'), OUT, { recursive: true });
  await fs.copyFile(path.join(ROOT, 'src', 'app.js'), path.join(OUT, 'app.js'));

  const posts = await loadPosts();
  const write = async (rel, html) => {
    const file = path.join(OUT, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, html);
  };

  await write('index.html', layout({
    page: 'home', cwd: '~', url: '/', title: cfg.title, description: cfg.description,
    body: homeBody(posts),
  }));
  for (const p of posts) {
    await write(path.join(p.url, 'index.html'), layout({
      page: 'post', cwd: `~/posts/${p.slug}.md`, url: p.url, title: p.title, description: p.description,
      image: p.image, body: postBody(p), prev: p.newer?.url, next: p.older?.url,
    }));
  }
  await write('404.html', layout({ page: '404', cwd: '~', url: '/404.html', title: 'not found', description: 'No such file or directory.', body: notFoundBody() }));
  await write('feed.xml', feed(posts));
  await write('sitemap.xml', sitemap(posts));
  await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('/sitemap.xml')}\n`);
  if (cfg.domain) await write('CNAME', cfg.domain + '\n');
  console.log(`built ${posts.length} post(s) → dist/ in ${Math.round(performance.now() - t0)}ms`);
}

await build();

// ---------------------------------------------------------------- dev server
if (argv.has('--serve')) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.xml': 'application/xml', '.txt': 'text/plain' };
  const port = Number(process.env.PORT || 8080);
  http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(OUT, p);
    if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) && existsSync(file + '/index.html')) file += '/index.html';
    if (!existsSync(file)) { file = path.join(OUT, '404.html'); res.statusCode = 404; }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  }).listen(port, () => console.log(`serving dist/ on http://localhost:${port}`));
  let timer;
  for (const d of ['content', 'src', 'static', 'site.config.json']) {
    watch(path.join(ROOT, d), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => build().catch(console.error), 80); });
  }
}
