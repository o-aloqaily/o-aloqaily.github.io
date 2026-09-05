# Osamh Aloqaili — personal site

A formal, editorial personal site and blog: profile, contact links and
writing. Plain static HTML with system fonts and no JavaScript, so every page
is a single small request.

- **No runtime dependencies at all.** No framework, no scripts, no web fonts,
  no analytics. One inlined stylesheet per page.
- **Build-time only deps:** `marked` (Markdown) and `highlight.js` (code).
- **Hosting:** GitHub Pages, deployed by `.github/workflows/deploy.yml` on every
  push to `main`.

## Write a post

```sh
npm run new -- "Title of the post"     # creates content/posts/YYYY-MM-DD-title-of-the-post.md
npm run dev                            # http://localhost:8080, rebuilds on save
```

Edit the Markdown file. The frontmatter fields:

| field         | notes                                                          |
| ------------- | -------------------------------------------------------------- |
| `title`       | shown in the list, the page and social cards                   |
| `slug`        | URL becomes `/posts/<slug>/` (defaults to the filename)         |
| `date`        | `YYYY-MM-DD`; posts are listed newest first                    |
| `description` | one or two sentences; used in the list, RSS and social cards   |
| `tags`        | `[go, concurrency]`                                            |
| `image`       | optional `/media/….jpg` for the social card (JPEG/PNG, not WebP) |
| `draft`       | `true` hides the post from the build                           |

Images go in `static/media/` and are referenced as `/media/name.webp`. Fenced
code blocks get syntax highlighting (` ```go `). Animated GIFs: convert to MP4
and reference the `.mp4`; the build renders a muted, looping `<video>` using a
`.webp` poster of the same name. `scripts/optimize-images.py` shows the exact
Pillow/ffmpeg commands used for the current assets.

Remove `draft: true`, commit, push to `main`. The site is live a minute later.

## Commands

```sh
npm install      # once
npm run build    # → dist/
npm run check    # build + verify links, image dimensions and size budget
npm run dev      # build, watch and serve dist/ locally
```

## Design

Serif body from the system font stack (Iowan Old Style, Palatino, Charter,
Georgia), sans-serif for labels, light by default and dark when the visitor's
OS prefers it. Post pages carry OpenGraph and Twitter card tags, share links
(X, LinkedIn, email) and newer/older navigation. RSS at `/feed.xml`.

The earlier terminal-style version is kept at the git tag
`terminal-shell-v1` for reference.

## Config

`site.config.json` holds the URL, name, tagline, prompt and social links. Add
`"domain": "osmh.dev"` to emit a `CNAME` file for a custom domain (then point
the domain at GitHub Pages and set `url` accordingly).
