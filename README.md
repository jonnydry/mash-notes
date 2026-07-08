# Mash

**Mash your ideas together in a reliable place.**

Fast, cute, minimal web notes — a canvas-first, local-only PWA. Open in any browser, no signup, no server required. Notes live in IndexedDB; export or import JSON anytime.

## Why Mash?

- **Instant** — Open the URL and start arranging notes on a desk.
- **Canvas-first** — Dock + peel to find notes; stickies on a board to mash them together.
- **Private by default** — Everything stays in your browser. No accounts, no cloud sync (yet).
- **Yours** — MIT open source. Self-host as a static site. Export Markdown + JSON.

## What’s in the app

- Vertical dock (Desk, Pinned, Folders, Tags, New, Search) with peel scanner tray
- Freeform canvas: pan, zoom, snap, align, expand/bump neighbors, layout undo
- Drag-to-mash, unmash, bulk tag/folder/copy/export
- Sticky editor with markdown preview + `[[wikilink]]` navigation
- Command palette (⌘K), search, folders/tags filters
- PWA install + offline static assets

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

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
npm run ci
```

## License

MIT

---

Made with potatoes. Mash responsibly.
