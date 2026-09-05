// node scripts/new-post.mjs "My Post Title"  → content/posts/YYYY-MM-DD-my-post-title.md
import fs from 'node:fs';
import path from 'node:path';
const title = process.argv.slice(2).join(' ').trim();
if (!title) { console.error('usage: npm run new -- "Post title"'); process.exit(1); }
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const date = new Date().toISOString().slice(0, 10);
const file = path.join(import.meta.dirname, '..', 'content', 'posts', `${date}-${slug}.md`);
if (fs.existsSync(file)) { console.error(`exists: ${file}`); process.exit(1); }
fs.writeFileSync(file, `---
title: ${title}
slug: ${slug}
date: ${date}
description: One or two sentences for the post list, search previews and social cards.
tags: []
draft: true
---

Write here. Remove \`draft: true\` to publish.
`);
console.log(`created ${path.relative(process.cwd(), file)}`);
