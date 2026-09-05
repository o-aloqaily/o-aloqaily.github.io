# osamh@blog:~$

Personal site and blog of Osamh Aloqaily. It behaves like an SSH session: you
land on `$ ssh guest@osmh`, get a login banner, and type real commands at a
working prompt (`help`, `ls posts`, `cat about.txt`, `cat posts/<file>.md`).
Every command and filename in the output is clickable and there are tap chips
under the prompt, so it works for people who never touch a terminal.

- **Zero runtime dependencies.** No framework, no web fonts, no analytics. One
  inlined stylesheet and one ~5KB deferred script per page.
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

## Shell

Commands: `help`, `ls [dir]`, `cat <file>`, `cd <dir>`, `open <n>`, `share`,
`links` (also `github`, `twitter`, `linkedin`, `email`), `theme [dark|light]`,
`clear`, `neofetch`, `whoami`, `date`, `history`, `exit`. Tab completes
commands and paths, ↑/↓ walk history, ctrl+c cancels, ctrl+l clears.

Every page is a complete pre-rendered transcript (home = banner + MOTD, post =
`cat posts/<file>.md` + the post), so shared links, social cards and no-JS
visitors all work; `app.js` only makes the prompt live. `cat` of a post fetches
`/posts/<slug>/body.html` and updates the URL.

## Config

`site.config.json` holds the URL, name, tagline, prompt and social links. Add
`"domain": "osmh.dev"` to emit a `CNAME` file for a custom domain (then point
the domain at GitHub Pages and set `url` accordingly).
