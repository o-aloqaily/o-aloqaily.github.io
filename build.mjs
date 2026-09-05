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
const banner = await fs.readFile(path.join(ROOT, 'src', 'banner.txt'), 'utf8');
const U = esc(cfg.prompt.user), H = esc(cfg.prompt.host);
const ps1 = (cwd = '~') => `<span class="ps1"><span class="u">${U}@${H}</span>:<span class="p">${esc(cwd)}</span>$</span>`;
const run = (cmd, label = cmd) => `<button type="button" class="run" data-cmd="${esc(cmd)}">${esc(label)}</button>`;
const postFile = p => `${p.slug}.md`;
// One transcript entry: the echoed command line + its output. app.js builds the same markup live.
const entry = (cmd, out, cwd = '~', cls = '') => `<div class="e${cls ? ' ' + cls : ''}"><div class="c">${ps1(cwd)} <span class="t">${esc(cmd)}</span></div><div class="o">${out}</div></div>`;

// Everything the terminal needs at runtime, embedded once per page.
const fsJson = posts => JSON.stringify({
  user: cfg.prompt.user, host: cfg.prompt.host, name: cfg.author.name, tagline: cfg.tagline,
  photo: cfg.author.photo, photo2x: cfg.author.photo2x, url: cfg.url, banner,
  links: cfg.links.map(l => ({ key: l.key, label: l.label, href: l.href, handle: l.handle })),
  posts: posts.map(p => ({ file: postFile(p), slug: p.slug, title: p.title, date: p.date, description: p.description, tags: p.tags, minutes: p.minutes, url: p.url })),
}).replace(/</g, '\\u003c');

const aboutOut = () => `<div class="who"><img class="avatar" src="${esc(cfg.author.photo)}" srcset="${esc(cfg.author.photo)} 1x, ${esc(cfg.author.photo2x)} 2x" width="96" height="96" alt="Photo of ${esc(cfg.author.name)}"><div><b class="name">${esc(cfg.author.name)}</b>
${esc(cfg.tagline)}

<span class="dim">Find me:</span> ${run('cat links.txt')}   <span class="dim">Read:</span> ${run('ls posts')}</div></div>`;

const linksOut = () => `<ul class="ls links">${cfg.links.map(l => `<li><span class="k">${esc(l.key)}</span><a href="${esc(l.href)}" rel="me noopener" target="_blank">${esc(l.label)}</a></li>`).join('')}</ul>`;

const lsPostsOut = posts => `<ul class="ls files">${posts.map(p => `<li><a class="file run" data-cmd="cat posts/${esc(postFile(p))}" href="${esc(p.url)}">${esc(postFile(p))}</a><span class="dim">${esc(p.date)} · ${esc(p.title)}</span></li>`).join('')}</ul>`;

const motd = posts => `<pre class="banner" aria-hidden="true">${esc(banner)}</pre><div class="motd">Welcome to <b>${H}</b> — the personal site of <b>${esc(cfg.author.name)}</b>.
<span class="dim">${esc(cfg.tagline)}</span>

  <span class="dim">who I am        </span>  ${run('cat about.txt')}
  <span class="dim">where to find me</span>  ${run('cat links.txt')}
  <span class="dim">${posts.length} post${posts.length === 1 ? ' ' : 's'}         </span>  ${run('ls posts')}
  <span class="dim">everything      </span>  ${run('help')}

<span class="dim">Last login: ${new Date().toISOString().slice(0, 10)} from 127.0.0.1. Type a command, press <kbd>tab</kbd> to complete, or click any of the above.</span></div>`;

const shortMotd = () => `<div class="motd">Welcome to <b>${H}</b> — ${esc(cfg.author.name)}'s site. Type ${run('help')} for commands.</div>`;

// The rendered post as terminal output; also written to /posts/<slug>/body.html for `cat` at runtime.
const postOut = p => `<article class="post"><header class="post-head"><h1>${esc(p.title)}</h1><p class="meta"><time datetime="${esc(p.date)}">${esc(p.date)}</time> <span class="dim">·</span> ${p.minutes} min read <span class="dim">·</span> ${p.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join(' ')}</p></header><div class="prose">
${p.html}
</div></article>
<div class="eof"><span class="dim">--- end of ${esc(postFile(p))} ---</span>  ${run('share')}${p.newer ? `  ${run('cat posts/' + postFile(p.newer), 'newer: ' + postFile(p.newer))}` : ''}${p.older ? `  ${run('cat posts/' + postFile(p.older), 'older: ' + postFile(p.older))}` : ''}  ${run('ls posts')}  ${run('help')}</div>`;

const promptHtml = () => `<form id="prompt" class="prompt" autocomplete="off"><label class="ps1" id="ps1" for="in"><span class="u">${U}@${H}</span>:<span class="p">~</span>$</label> <span class="typed" id="typed"></span><span class="cursor" id="cursor"></span><input id="in" type="text" aria-label="Type a command" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" enterkeyhint="send"></form>
<div class="chips js-only" aria-label="quick commands"><span class="dim">tap:</span> ${run('help')} ${run('cat about.txt', 'about')} ${run('ls posts', 'posts')} ${run('cat links.txt', 'links')} ${run('clear')}</div>
<noscript><p class="dim small">JavaScript is off, so the prompt above is static. Everything is still reachable through the links in the welcome text.</p></noscript>`;

function layout({ title, description, url, image, body, page, posts, prev, next }) {
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
<main class="term" id="term">
<div id="out">
${body}
</div>
${promptHtml()}
</main>
<script id="fs" type="application/json">${fsJson(posts)}</script>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

const sshLine = () => `<div class="e boot" id="boot"><div class="c"><span class="ps1 local">$</span> <span class="t" id="ssh-cmd">ssh ${U}@${H}</span></div><div class="o" id="ssh-out"></div></div>`;
const homeBody = posts => sshLine() + `<div class="e" id="motd-entry"><div class="o">${motd(posts)}</div></div>`;
const postBody = (p, posts) => sshLine() + `<div class="e"><div class="o">${shortMotd()}</div></div>` + entry(`cat posts/${postFile(p)}`, postOut(p));
const notFoundBody = () => sshLine() + `<div class="e"><div class="o">${shortMotd()}</div></div>` + entry('cat <span id="nf-path">/that/page</span>', `<span class="err">cat: no such file or directory (404)</span>\nTry ${run('ls')} or ${run('help')}.`).replace('<span class="t">cat &lt;span id=&quot;nf-path&quot;&gt;/that/page&lt;/span&gt;</span>', '<span class="t">cat <span id="nf-path">/that/page</span></span>') + `<script>document.getElementById('nf-path').textContent=location.pathname</script>`;

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
    page: 'home', url: '/', title: cfg.title, description: cfg.description, posts,
    body: homeBody(posts),
  }));
  for (const p of posts) {
    await write(path.join(p.url, 'index.html'), layout({
      page: 'post', url: p.url, title: p.title, description: p.description, posts,
      image: p.image, body: postBody(p, posts), prev: p.newer?.url, next: p.older?.url,
    }));
    await write(path.join(p.url, 'body.html'), postOut(p));
  }
  await write('404.html', layout({ page: '404', url: '/404.html', title: 'not found', description: 'No such file or directory.', posts, body: notFoundBody() }));
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
