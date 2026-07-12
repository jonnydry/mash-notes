# MASH performance, bugs & UI/UX review

Date: 2026-07-12  
Scope: Full codebase review (working tree clean on `main`)  
Method: Parallel deep-dives on performance, correctness, and UI/UX with source verification of top findings. No live screen-reader or low-end device profile.

---

## Executive summary

MASH is a strong local-first canvas workbench. Since the 2026-07-10 product review, real product work shipped: sessions/Finish, paste intake, Try a mash, mobile auto-fit, condensed mobile chrome, focus traps, operator kitchen, and performance budgets with deferred PDF tooling.

The highest-impact remaining work falls into three buckets:

| Area | Dominant risk |
| --- | --- |
| **Performance** | Multi‑MB image data URLs inside note bodies → heap, search, and keystroke thrash |
| **Correctness** | Sync import demotes kept notes; desk LWW can resurrect removed cards; canvas load races |
| **UI/UX** | Confirm Enter always confirms; mobile menus/selection density; New note still maximizes stage |

**Issue inventory (deduped across three reviews):** ~18 bugs · ~28 suggestions · ~12 nits

---

## What’s already solid (do not regress)

- Lazy PDF/docx/html readers + board-image export; PWA precache exclusion for deferred features
- Sticky save debounce (400ms); canvas move rAF coalescing; peel `VirtualList` + UI cap
- Markdown sticky preview escapes raw HTML; blocks `javascript:` / `data:` link schemes (mostly)
- Modal focus traps on Confirm, Session/Finish, Paste, Shortcuts, Spaces, palette
- Mobile auto-fit, condensed canvas chrome, library load/write error banners
- Session lifecycle with Finish takeaway, recovery, e2e coverage

---

## P0 — Fix soon (bugs with user-visible or data impact)

### 1. Confirm dialog: Enter always confirms

**File:** `src/lib/components/ConfirmDialog.svelte:34-38`

While open, **any Enter** calls `onConfirm()`, even when focus is on Cancel. Destructive flows (delete, clear desk) are easy to mis-confirm.

**Fix:** Confirm on Enter only when the primary button is focused (or remove the global handler and rely on the focused button). Keep Escape → cancel.

---

### 2. Sync import demotes kept notes

**File:** `src/lib/stores/note-library.svelte.ts:571-583`

After merge, every note is rewritten:

```ts
sessionId,  // active scratch session
scope,      // 'session' on scratch desks
```

Kept pantry notes that appear in export/import become `scope: 'session'` on the current scratch desk. They can later expire or clear with the desk.

**Fix:** Preserve existing `scope` / `sessionId` / `keptAt` for kept notes. Only stamp session ownership on notes newly owned by this desk. Export scope fields faithfully.

---

### 3. Desk LWW resurrects removed placements

**File:** `src/lib/sync-file.ts:542-563`

When a remote placement has no local counterpart (`!existing`), it is **always inserted**, even if the local canvas is newer. Importing an older bundle can put back cards the user already removed (especially root desk, where dismissals are not always recorded).

**Fix:** Gate inserts on `remoteNewer` (or a per-placement clock). When local canvas wins, skip remote-only placements.

---

### 4. Canvas load races (drop / tray / new note)

**Files:** `src/lib/stores/canvas-session.svelte.ts` (`refreshCanvasItems`, `openStickyFromTray`, drop paths)

Some mutations bump `canvasLoadSeq` so in-flight membership reloads are ignored. Drop, tray open, and simple refresh **do not**. An in-flight `loadContextCanvas` can overwrite `canvasItems` with a pre-mutation snapshot → card appears then vanishes.

**Fix:** Bump `canvasLoadSeq` at the start of those paths; make `refreshCanvasItems` refuse stale seqs.

---

### 5. `loadNotes()` has no generation guard

**File:** `src/lib/stores/note-library.svelte.ts:478-531`

Rapid desk switches can leave a slow load writing the wrong session’s notes into the active library. Canvas loading is seq-protected; the library is not.

**Fix:** Capture `sessionId` + `++loadSeq` at start; abort after each `await` if stale.

---

### 6. Delete / folder cleanup leaves edge orphans

**Files:** `src/routes/+page.svelte:413-429`

- Library delete filters in-memory items but not `canvasEdges` or undo stack.
- Folder delete removes items + canvas row but never `canvasEdges` for that canvas → permanent IDB orphans.

**Fix:** Prune edges (and undo) on note delete; cascade-delete edges when deleting a folder canvas.

---

### 7. `keepActive` promotes soft-deleted notes

**File:** `src/lib/stores/sessions.svelte.ts:189-194`

Marks **all** session notes as kept, including `deletedAt` tombstones.

**Fix:** Filter `deletedAt == null` before promoting.

---

### 8. Image data URLs as note bodies (perf + OOM)

**Files:** `src/lib/desk-image.ts`, search hydrate, `filterPeelNotes`, canvas previews

Visual stickies embed multi‑MB base64 in `note.body`. Full library load, MiniSearch, peel filter (`body.toLowerCase()`), link maps, and card previews all scan those strings. GIF explode (≤36 frames) and bulk paste (≤50) amplify spikes.

**Fix (phased):**

1. **Now:** Strip `data:` images from search index / peel filter / `notePreview` fast path; never lowercase full bodies.
2. **Next:** Dexie blob table or OPFS + short body refs; object URLs with revoke on cull.
3. Stop full-library `notes.map` on every sticky keystroke — draft locally, commit on debounce.

---

## P1 — High-value performance & UX

### Performance

| Issue | Where | Action |
| --- | --- | --- |
| Full-array rewrite per keystroke | `note-library` sticky handlers | Local draft + map-based updates |
| Peel / palette full-body scan | `filterPeelNotes`, palette jump | Title/tags only or MiniSearch on stripped text |
| Canvas drag remaps all items | `canvas-session`, `CanvasBoard` | Patch moved ids; rAF pan/resize; cull earlier |
| gifuct-js on critical path | `+page` → `gif-explode` | Dynamic import on GIF drop only |
| All typography suites in layout CSS | `fonts.css` / layout | Lazy-load inactive font suites |
| Monolithic `+page.svelte` (~4k) | route | Split Settings/Spaces/Finish/Session behind `import()` |
| IDB position double-write | `updateCanvasItemPosition` | Batch positions; touch canvas once per gesture |
| Protocol-relative `//…` links | `markdown.ts` `isSafeHref` | Reject `//`; allowlist-only schemes |
| HTML/docx `{@html}` | `HtmlReader`, `DocxReader` | Block `data:` hrefs; sanitize mammoth HTML |

### UI/UX & a11y

| Issue | Where | Action |
| --- | --- | --- |
| Mobile More nav: no trap / Escape / outside dismiss | `MashDock` | Menu pattern + focus restore |
| Mobile canvas tools stay open on blank press | `CanvasBoard` | Close on board pointerdown |
| New note always maximizes stage | `handleNewNote` | Expand in-place; stage on explicit Edit |
| Selection bar overcrowded on phone | selection bar + CSS | Mash + Edit + More; ≥44px targets |
| Flat command palette | `+page` palette | Group Create / Transform / Import / Nav; empty state |
| Mash & Transform share Layers icon | selection bar | Distinct icons |
| Screenplay / Peel “scanner” language | Spaces, peel ARIA | Lead with “Open desks” / “Ingredients” |
| Mobile dock not New · Ingredients · Finish | `MashDock` | Product-review mobile primary actions |
| Dialogs initial-focus close (X) | several modals | Focus primary choice first |
| Muted 10px chrome contrast | `layout.css`, chips | Raise tokens / min 12px for muted |

---

## Prior product audit (2026-07-10) status

| Finding | Status |
| --- | --- |
| Session / Finish lifecycle | **Fixed** |
| Paste intake on empty desk | **Fixed** |
| Mobile auto-fit / condensed chrome | **Fixed** |
| Modal focus traps | **Fixed** (primary modals) |
| Transient fragments vs durable notes | **Partial** — sessions exist; notes still durable by default |
| Flat command palette | **Open** |
| Screenplay / Peel self-teaching | **Partial** |
| New note → full editor | **Open** |
| Settings storage-oriented Data list | **Open** |
| Quiet desk chrome | **Partial** |
| Mobile dock New / Ingredients / Finish | **Open** |

---

## Recommended roadmap

### Week 1 — Correctness & safety

1. ConfirmDialog Enter handling  
2. Sync import preserve kept scope  
3. Desk LWW gate on inserts  
4. Canvas load seq on drop/tray/refresh  
5. `loadNotes` generation guard  
6. Edge prune on delete / folder remove  
7. `keepActive` skip tombstones  
8. Reject `//` hrefs  

### Week 2 — Performance that users feel

1. Strip images from search + peel filter + previews  
2. Sticky edit draft (no full-library rewrite per key)  
3. Dynamic-import gifuct; extend perf budget allowlist  
4. Lazy inactive font suites  

### Week 3 — UI/UX polish

1. Mobile selection bar + touch targets  
2. Dock / tools menu dismiss + focus  
3. New-note in-place expand  
4. Palette grouping + activedescendant  
5. Language + icon pass (Screenplay, Ingredients, Mash vs Transform)  

### Later

- Blob/OPFS image storage  
- Canvas position map / lower cull threshold  
- Route-split chrome panels  
- Decompose `+page` / `CanvasBoard` into controllers (prior eng priority)  

---

## Evidence limits

- No full VoiceOver / NVDA pass  
- No low-end Android profiling of image-heavy desks  
- No multi-device sync round-trip against real older bundles (LWW issues inferred from merge logic)  
- Working tree was clean; this is a product/codebase review, not a PR diff review  

---

## Artifact paths

Detailed raw notes from specialized reviewers:

- Performance: `/tmp/grok-501/mash-perf-review.md` (ephemeral TMP)  
- Bugs: `/tmp/grok-501/mash-bugs-review.md`  
- UI/UX: `/tmp/grok-501/mash-ux-review.md`  

This file is the durable consolidated deliverable under `audit/`.
