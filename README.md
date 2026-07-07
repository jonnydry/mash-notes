# 🥔 Mash

**Mash your ideas together in a reliable place.**

Fast, cute, minimal web-based notes. An open-source, private, keyboard-first PWA — the lightweight Obsidian you can open in any browser instantly.

No signup. No server required. Your notes live in your browser (IndexedDB). Export anytime as clean Markdown + JSON.

## Why Mash?

- **Instant** — Go to the URL and start typing. No accounts, no loading screens.
- **Cute but serious** — Friendly potato mascot, but built for real knowledge work (folders, tags, wikilinks, powerful search, command palette).
- **Fast & reliable** — CodeMirror 6 editor, excellent offline support, virtualized UI, designed for thousands of notes.
- **Yours** — Fully open source (MIT). Export everything. Self-hostable as a static site. No lock-in.

## Branding

Mash features a cute potato mascot (because you _mash_ ideas together).

**Current official logo**: The friendly character-style potato from this Grok Imagine generation:  
https://grok.com/imagine/post/f6c7baa3-c2a9-4b0f-8fe4-327b589a7a75

App icons and assets are derived from this image (stored in `static/icons/`).

A fully functional multi-pane UI shell is implemented: folders + tags sidebar, searchable/filterable note list, live editor with autosave, ⌘K command palette, pin, delete, etc.

## Quick Start

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Tech Stack (Best-in-Class for This Vision)

- Svelte 5 + SvelteKit (static)
- CodeMirror 6 (editor)
- Dexie + MiniSearch (data + search)
- Tailwind + bits-ui + shadcn-style components
- Full PWA (offline-first, installable)

See the detailed implementation plan in `.grok/sessions/.../plan.md` for architecture, data model, and feature phases.

## Development

```bash
npm run dev          # dev server
npm run build        # production build
npm run preview      # preview production build
npm run check        # type check
npm run lint
npm run format
```

## License

MIT — build whatever you want with it.

---

Made with ❤️ and potatoes. Mash responsibly.
