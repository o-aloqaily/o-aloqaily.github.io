// Sanity checks on dist/: required files exist, every local link/asset resolves,
// and the pages stay within the performance budget.
import fs from 'node:fs';
import path from 'node:path';
const DIST = path.join(import.meta.dirname, '..', 'dist');
const BUDGET = { 'index.html': 16_000 };
let fail = 0;
const bad = m => { console.error('✗ ' + m); fail++; };
for (const f of ['index.html', 'feed.xml', 'sitemap.xml', '404.html', 'robots.txt', 'favicon.svg']) {
  if (!fs.existsSync(path.join(DIST, f))) bad(`missing dist/${f}`);
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const pages = walk(DIST).filter(f => f.endsWith('.html'));
for (const f of pages) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src|poster)="(\/[^"#?]*)/g)) {
    let p = path.join(DIST, m[1]);
    if (m[1].endsWith('/')) p = path.join(p, 'index.html');
    if (!fs.existsSync(p) && !fs.existsSync(path.join(p, 'index.html'))) bad(`${path.relative(DIST, f)} → ${m[1]} does not exist`);
  }
  for (const m of html.matchAll(/<img [^>]*>/g)) if (/src="\//.test(m[0]) && !/width="\d+"/.test(m[0])) bad(`${path.relative(DIST, f)}: <img> without width/height: ${m[0].slice(0, 80)}`);
}
for (const [f, max] of Object.entries(BUDGET)) {
  const size = fs.statSync(path.join(DIST, f)).size;
  size > max ? bad(`${f} is ${size} bytes (budget ${max})`) : console.log(`✓ ${f} ${size} bytes (budget ${max})`);
}
console.log(fail ? `${fail} problem(s)` : `✓ ${pages.length} pages, all links and assets resolve`);
process.exit(fail ? 1 : 0);
