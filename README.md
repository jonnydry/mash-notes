# Mash

**Mash your ideas together in a reliable place.**

Fast, cute, minimal web notes — a canvas-first, local-only PWA. Open in any browser, no signup, no server required. Notes live in IndexedDB; export JSON anytime, or move a **sync bundle** (notes + desk layout) between devices via file.

## Why Mash?

- **Instant** — Open the URL and start arranging notes on a desk.
- **Canvas-first** — Dock + peel to find notes; stickies on a board to mash them together.
- **Private by default** — Everything stays in your browser. No accounts. Optional file sync bundles for a two-device loop.
- **Yours** — MIT open source. Self-host as a static site. Export Markdown + JSON.

## What’s in the app

- Vertical dock (Desk, Pinned, Folders, Tags, Linked, New, Search, Settings) with peel scanner tray
- Peel **Ingredients** tray — All / Desk / Kept scope chips; kept pantry available on scratch desks without a permanent-library feel
- Empty desk **Try a mash** — one disposable demo (two scraps → select → Mash); dismiss forever
- **Settings** tray — theme, snap, import/export (JSON + markdown vault + sync bundle), keyboard shortcuts, about
- Freeform canvas: pan, zoom, snap, align, expand/bump neighbors, layout undo
- Quiet board chrome — Free/Snap · Sequence · Fit · Undo on the desk; Organize/Select all/Reset under **View**
- Drag-to-mash, selection Mash (with confirm), unmash
- Selection bar: primary kitchen verbs (Keep · Mash · Transform · Pack · Edit · Delete); Tag/Folder/Copy/export under **More**
- **Keep** selected cards mid-desk (promote scratch ingredients to durable kept notes without Finish)
- **Operator kitchen** (Transform) — Shape / Arrange groups with plain subtitles, plus a last **receipt** strip (inputs → outputs, Undo when available)
- Sticky editor with markdown preview + `[[wikilink]]` navigation (missing targets ask before create) and Linked peel / backlinks
- File sync bundles via Settings or ⌘K — **Export / Import sync bundle…** (notes + canvases + placements + edges + dismissals, LWW merge; body conflicts offer Restore local)
- **Import markdown vault…** — pick an Obsidian vault folder or Bear `.md` export; folders, YAML frontmatter, `[[wikilinks]]`, and `#tags` map into Mash
- Command palette (⌘K), search, folders/tags filters
- Mobile / coarse-pointer desk: bottom dock, peel + selection bar above it, long-press place from peel
- Drop or open **Word (.docx)** or **HTML** documents in a read-only reader and clip text to stickies (PDF reader remains for PDFs)
- Drop, paste, or open **images** (PNG, JPEG, WebP, GIF) as visual stickies on the desk
- **Explode** animated GIFs into a set of frame cards (or keep a still) — cap 36 frames with even sampling
- Paste **http(s) URLs** (one per line) as link source cards — local hostname titles, no cloud fetch
- PWA install + offline static assets

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Sync between devices

1. On device A: open **Settings** (dock) or ⌘K → **Export sync bundle…** → save the JSON file.
2. On device B: **Settings** or ⌘K → **Import sync bundle…** → pick that file.
3. Notes merge last-write-wins; desk layout (placements / dismissals) comes along. Body conflicts offer **Restore local**.

Notes-only **Export / Import JSON** still exists for backups without desk state.

## Import from Obsidian or Bear

1. Dock **Settings** → **Import markdown vault…** (or ⌘K → same command).
2. Choose your Obsidian vault folder, or a folder of Bear-exported `.md` files (Chrome/Edge/Safari support folder pick).
3. Mash creates new notes (up to 5000): relative folders become Mash folders, YAML `tags` / `#inline` tags become tags, and `[[wikilinks]]` stay as-is.

`.obsidian`, `.trash`, and non-markdown files are skipped. This is a one-shot import — it does not watch the vault for changes.

## Tech stack

- Svelte 5 + SvelteKit (static adapter)
- Dexie (IndexedDB) + MiniSearch
- Tailwind CSS 4
- marked (safe sticky preview)
- vite-plugin-pwa

## Development

```bash
npm run dev
npm run build
npm run preview
npm run check
npm run test
npm run test:e2e
npm run ci
```

GitHub Actions runs `check`, unit tests, production build, and Playwright e2e (smoke, linked, sync) on every pull request and push to `main`.

## License

MIT

---

Made with potatoes. Mash responsibly.
