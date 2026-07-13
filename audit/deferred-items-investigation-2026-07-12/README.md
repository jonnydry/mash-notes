# Deferred items investigation

Date: 2026-07-12  
Context: Follow-on from `audit/performance-bugs-ux-2026-07-12` after Week 1–3 fixes shipped.

## Decision log (2026-07-12)

Product input: **most desks will not carry many images.**

| Item                       | Decision                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Blob / OPFS image storage  | **Shipped (Dexie `noteBlobs` + `mash-blob:` refs).** OPFS still deferred. Legacy data-URL notes migrate on load. Sync bundle v5 carries blobs. |
| Chrome dynamic import      | **Shipped** — Settings, Shortcuts, Spaces, Session/Finish, Paste, GIF. Finish button preloads Session chunk on hover/focus.                    |
| +page / CanvasBoard decomp | **Incremental only** when touching a domain — no big-bang rewrite.                                                                             |

### Phase 0 results (after dynamic chrome)

| Metric                                                |        Before |               After |
| ----------------------------------------------------- | ------------: | ------------------: |
| Initial JS (budget)                                   |      ~618 KiB |   **586 KiB** / 640 |
| Page chunk `nodes/2`                                  |       ~480 KB |         **~234 KB** |
| Settings / Session / Spaces / Shortcuts / Paste / GIF | initial graph | **deferred chunks** |

---

## Scope

Three items were explicitly deferred as “Later”:

1. **Blob / OPFS storage for images** (vs multi‑MB data URLs in `note.body`)
2. **Decomposition** of `+page.svelte` / `CanvasBoard.svelte` into controllers
3. **Route-splitting chrome panels** (Settings, Spaces, Finish/Session, Shortcuts, etc.)

This doc maps current state, blast radius, effort, and a recommended order.

---

## Snapshot of the codebase today

| Hotspot                    |                        Lines | Role                                                                  |
| -------------------------- | ---------------------------: | --------------------------------------------------------------------- |
| `src/routes/+page.svelte`  |                       ~4,160 | App orchestrator: sessions, finish, paste, readers, operators, chrome |
| `CanvasBoard.svelte`       |                       ~2,845 | Gesture/viewport/selection/flow UI + chrome                           |
| `canvas-session.svelte.ts` |                       ~1,520 | Canvas IDB + layout undo + drop/mash                                  |
| `note-library.svelte.ts`   |                       ~1,190 | Notes library, sticky save, sync import                               |
| Production page chunk      | **~480 KB** (`nodes/2.*.js`) | Nearly all app UI in one module                                       |

**Already deferred / code-split:** PDF/docx/html readers, board-image export, GIF explode + gifuct (dynamic).  
**Still static in `+page`:** Settings, Session/Finish, Spaces, Shortcuts, Paste dialog, Peel, Dock, CanvasBoard, EditorStage, Confirm.

**Image architecture (v1 design, intentional):**  
`docs/superpowers/specs/2026-07-11-image-visual-stickies-design.md` chose embedded data URLs and listed a separate blob table as **non-goal for v1** (“future if desks grow heavy”). PDF clips use the same body pattern.

---

## 1. Blob / OPFS storage for images

### Current model

```
File → prepareDeskImage() → data URL string
  → note.body = `![alt](data:image/...)\n\ncaption`
  → full Note row in IndexedDB
  → loadNotes() materializes all bodies into reactive `notes[]`
  → CanvasBoard: parseEmbeddedNoteImage(note.body) → <img src={dataUrl}>
  → sync/export: bodies ride JSON as-is
```

Same path for PDF region clippings, image stickies, GIF frames, rotate (`image-rotate.ts` rewrites body data URLs).

### What we already mitigated

- Search indexes stripped/capped bodies (`bodyForSearchIndex`)
- Peel / palette quick-filter avoid full base64 lowercasing
- Preview/link/wikilink fast paths for image bodies
- Sticky `patchNote` + map (not full rebuild of every Map)

**Residual risk:** heap still holds every image body string after load; visible cards still decode huge data URLs into bitmaps; sync bundles and JSON export still bloat; IDB structured-clone of multi‑MB strings on every sticky persist remains expensive.

### Design options

| Option                             | Summary                                                             | Pros                                                               | Cons                                                                    |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **A. Dexie `blobs` table**         | `id, mime, bytes (ArrayBuffer/Blob), width, height, created`        | Fits existing stack; no OPFS API quirks; works offline same origin | Still main-thread decode; sync must special-case                        |
| **B. OPFS**                        | File handles under origin private FS                                | Better for large binaries; streamable                              | Safari maturity / private mode; more plumbing; dual path with IDB notes |
| **C. Hybrid**                      | Small thumbs in body or cache; full res in blob/OPFS                | Collapsed cards stay cheap                                         | Two representations; rotate/export complexity                           |
| **D. Stay data-URL + harder caps** | Lower max edge / quality; refuse bulk GIF explode more aggressively | No migration                                                       | Ceiling still OOM-ish with many images                                  |

**Recommended target:** **A then C** — Dexie blobs first; optional thumbnail field for board cards; OPFS only if desks regularly exceed IDB comfort (~tens of MB of pixels).

### Proposed schema (sketch)

```ts
// types
interface NoteBlob {
	id: string;
	mime: string; // image/png | image/jpeg | ...
	bytes: ArrayBuffer; // or Blob
	width: number;
	height: number;
	created: number;
	// optional: sha256 for dedupe
}

// note.body becomes reference form:
// ![alt](mash-blob:<blobId>)\n\ncaption
// OR structured fields later: note.media = { blobId, alt }
```

Dexie **v9**:

```ts
blobs: 'id, created, mime';
```

### Blast radius (must update)

| Area                                        | Work                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `desk-image.ts`                             | Write blob + return ref body, not data URL                                         |
| `pdf-clipping` / docx / html clips          | Same if they embed PNGs                                                            |
| `image-rotate.ts`                           | Read blob → rotate → write new blob; update note ref                               |
| `parseEmbeddedNoteImage` / `isSafeImageSrc` | Accept `mash-blob:` scheme; resolve via async helper                               |
| `CanvasBoard` / `StickyEditor`              | Object URLs + revoke on unmount/cull; don’t put ArrayBuffers in every note         |
| `search` / `format` / `peelSearchText`      | Already mostly fine if body is short ref                                           |
| Sync bundle                                 | Export blobs as base64 map or separate section; version bump; import creates blobs |
| Finish / board-image / sequence-PDF         | Resolve blob → pixels for canvas draw                                              |
| Markdown export                             | Inline data URL at export time OR skip binary                                      |
| Migration                                   | Scan notes for `data:image`, extract to blobs, rewrite bodies                      |

### Effort estimate

| Phase                                                    | Effort       | Outcome                              |
| -------------------------------------------------------- | ------------ | ------------------------------------ |
| Spec + types + Dexie v9 + write path only for new images | **2–4 days** | New images stop growing body strings |
| Display resolve + object URL lifecycle                   | **2–3 days** | Cards/editor work off refs           |
| Migration of existing data-URL notes                     | **1–2 days** | Old desks heal                       |
| Sync/export/import + Finish/PDF/board export             | **3–5 days** | No silent data loss                  |
| Thumbnails + concurrent decode caps                      | **2–3 days** | Mobile/low-end desk comfort          |

**Total:** ~**2–3 weeks** careful work with tests; high correctness risk if sync is rushed.

### Risks

1. **Sync LWW** without blob payloads = broken remote images.
2. **Object URL leaks** if not revoked on cull/session switch.
3. **Mash combine** of image notes must preserve blob refs (not stringify wrongly).
4. **CSP** already allows `img-src data: blob:` — good.
5. Design doc non-goal: product accepted data URLs until desks “grow heavy” — ship when metrics say so (e.g. note body p95, OOM reports).

### Decision criteria to start now

Start blob store if any of:

- Users regularly paste ≥5 large screenshots per desk
- Sync files routinely >5–10 MB
- Low-end devices hitch after load with image desks

Otherwise keep mitigations and **soft-cap more aggressively** (cheaper).

---

## 2. Decomposition of `+page` / `CanvasBoard`

### Current architecture (already partially extracted)

```
+page.svelte (orchestrator)
  ├─ createSessionManager()
  ├─ createNoteLibrary()
  ├─ createCanvasSession()
  ├─ createPeelNav() / createOpenSpaces() / createEditorStage()
  ├─ operator kitchen + action registry
  ├─ readers (lazy modules)
  └─ huge markup: header, selection bar, palette, dialogs, peel, dock, canvas
```

Stores absorbed a lot of domain logic; **UI and cross-feature wiring** still live in `+page`. CanvasBoard owns **presentation + gestures** with a very wide props/callback surface.

### Pain points

1. **Change cost:** Any feature (paste, keep, finish, operators) touches the same file.
2. **Testability:** Integration is e2e-heavy; unit tests can’t exercise orchestration easily.
3. **HMR / review size:** 4k-line diffs are hard to review.
4. **Prop drilling:** CanvasBoard’s `Props` interface is enormous; page wires every handler.
5. **Not primarily a byte problem:** Extracting TS modules without dynamic `import()` **does not** shrink `nodes/2` much (bundler still graphs them). Decomposition is **maintainability** first; pair with route-split for weight.

### Natural seams (recommended modules)

| Module                                 | Extract from | Contents                                                      |
| -------------------------------------- | ------------ | ------------------------------------------------------------- |
| `lib/app/document-readers.ts` or store | +page        | PDF/docx/html open/hide/clip/resume                           |
| `lib/app/intake-pipeline.ts`           | +page        | Drop/paste/image/gif/url/markdown vault routing               |
| `lib/app/finish-session-ui.ts`         | +page        | Finish export/commit, session switch prep                     |
| `lib/app/selection-operators.ts`       | +page        | Mash/split/sort/pack/kitchen invoke                           |
| `lib/app/command-palette.ts`           | +page        | Registry + grouping + keyboard (already partially structured) |
| `lib/canvas/gestures/*`                | CanvasBoard  | Marquee, drag, resize, pan/zoom (pure-ish + small state)      |
| `lib/canvas/flow-chrome.ts`            | CanvasBoard  | Sequence mode, edge paths, export/print sequence              |
| `components/CanvasChrome.svelte`       | CanvasBoard  | Free/Snap, Sequence, Fit, View, mobile tools                  |

**Avoid** a single “god store” that re-creates `+page`. Prefer **use-case modules** the page composes.

### CanvasBoard split strategy

1. **Keep** one board host for coordinate space + item layer.
2. **Extract** chrome to child components (desktop strip + mobile tools already semi-isolated in markup).
3. **Extract** pure geometry/gesture helpers already partly in `canvas-geom.ts` / session store.
4. **Optional** controller class `createBoardGestures({ getItems, onMove… })` tested without Svelte.

### Effort estimate

| Slice                             | Effort       | Value                       |
| --------------------------------- | ------------ | --------------------------- |
| Extract intake pipeline (+ tests) | **2–3 days** | High — most growing edge    |
| Extract readers module            | **1 day**    | Medium                      |
| Extract selection/operators       | **2 days**   | High                        |
| Canvas chrome components          | **1–2 days** | Medium UX + clarity         |
| Full gesture controller           | **3–5 days** | Medium; risk of regressions |

**Total for “good enough” structure:** ~**1.5–2 weeks**, incremental PRs.  
**Full purity rewrite:** multi-week, diminishing returns.

### Risks

- Behavioral regressions in drag/mash/sequence (cover with existing e2e: canvas, mash, mobile, finish).
- Over-abstracting before seams stabilize.
- Extract without dynamic import → **no perf win**, only clarity.

---

## 3. Route-splitting chrome panels

### Current state

| Component                    |   Lines | Import style                  |
| ---------------------------- | ------: | ----------------------------- |
| SettingsPanel                |     300 | **static** in +page           |
| SessionPanel (+ FinishPanel) | 256+333 | **static**                    |
| SpacesOverview               |     230 | **static**                    |
| ShortcutsModal               |      94 | **static**                    |
| PasteChoiceDialog            |     117 | **static**                    |
| GifExplodeDialog             |     109 | **dynamic** `{#await import}` |
| Pdf/Docx/Html readers        |   large | **lazy modules** already      |

All static panels compile into **`nodes/2` (~480 KB raw)**. Initial JS budget is already near the ceiling (617 / 640 KiB after recent work).

### What “route-splitting” means here

Not SvelteKit multi-route SPA navigation (app is single-page canvas). Means:

```ts
// when settingsOpen becomes true
const SettingsPanel = (await import('$lib/components/SettingsPanel.svelte')).default;
```

or Svelte:

```svelte
{#if settingsOpen}
	{#await import('...') then m}
		<m.default ... />
	{/await}
{/if}
```

Same pattern as GifExplodeDialog.

### Expected savings (order of magnitude)

Panels themselves are small (~100–300 lines each), but they pull:

- Settings: import/export UI, typography suite list, sync hygiene copy
- Session/Finish: finish-model, export kinds, confirm flows
- Spaces: preview geometry

Realistic first-paint win: **tens of KB** gzipped combined—not another 200 KB—unless Settings pulls heavy deps (today it largely does not). **Still worth it** to keep headroom under the perf budget as features grow.

**CanvasBoard cannot be deferred** on first paint (it _is_ the product). Peel/Dock should stay static (always visible chrome).

### Priority order for dynamic import

| Priority | Panel                              | Trigger              | Notes                                                          |
| -------- | ---------------------------------- | -------------------- | -------------------------------------------------------------- |
| 1        | SettingsPanel                      | `settingsOpen`       | Rare vs desk time                                              |
| 2        | ShortcutsModal                     | `shortcutsOpen`      | Rare                                                           |
| 3        | SpacesOverview                     | `spacesOverviewOpen` | Occasional                                                     |
| 4        | SessionPanel / Finish              | `sessionPanelOpen`   | More common but still modal                                    |
| 5        | PasteChoiceDialog                  | paste multi-line     | Latency-sensitive; keep static or preload on first paste event |
| —        | CanvasBoard, MashDock, PeelScanner | always               | Do not split                                                   |

### Effort estimate

| Work                                                    | Effort        |
| ------------------------------------------------------- | ------------- |
| Convert 4 modals to `{#await import}` + loading null    | **0.5–1 day** |
| Extend perf budget / e2e to assert not in initial graph | **0.5 day**   |
| Preload Session on hover of Finish button (optional)    | **hours**     |

**Total:** **~1–2 days** for solid wins. Lowest risk deferred item.

### Risks

- First open flash (mitigate: tiny skeleton or `import()` on pointerenter).
- SSR: app is already static SPA-oriented; check `ssr=false` page config remains compatible.
- Prop types: dynamic components need careful typing (same as GifExplode).

---

## Cross-cutting comparison

| Item                      | User impact                   | Eng risk             | Effort                  |              Perf win | Recommend                 |
| ------------------------- | ----------------------------- | -------------------- | ----------------------- | --------------------: | ------------------------- |
| **Chrome dynamic import** | Low (slight first-open delay) | Low                  | 1–2 days                | Small–medium headroom | **Do next**               |
| **+page / board decomp**  | None direct                   | Medium (regressions) | 1.5–2 weeks incremental | None unless + dynamic | **Do alongside features** |
| **Blob/OPFS images**      | High for image-heavy desks    | High (sync/migrate)  | 2–3 weeks               |  High for heavy desks | **Do when data says so**  |

---

## Recommended sequence

### Phase 0 — Now (cheap)

1. Dynamic-import **Settings, Shortcuts, Spaces, Session/Finish**.
2. Add them to deferred perf-budget names if they appear as named chunks.
3. Optional: preload Finish on `pointerenter` of header Finish button.

### Phase 1 — Next feature work (structure)

When touching a domain, extract a module instead of growing +page:

1. Intake pipeline (drop/paste/files)
2. Document readers façade
3. Selection operators / kitchen
4. Canvas chrome components

Rule of thumb: **no new 200-line feature blocks inside +page** — new file + thin page wiring.

### Phase 2 — When image desks hurt

1. Design note: `mash-blob:` body scheme + Dexie `blobs` + sync section.
2. Write path for new images + migration.
3. Object URL render path + revoke.
4. Sync/export/Finish/PDF export resolution.
5. Thumbnails / decode concurrency.

Skip OPFS until Dexie blobs prove insufficient.

---

## Open questions for product

1. **How image-heavy are real desks?** (If mostly text + few clips, blob store can wait.)
2. **Is multi-device sync of images a must?** (If yes, blob work includes sync day-one; if single-device, simpler.)
3. **Accept first-open spinner for Settings/Finish?** (Usually yes for local tools.)
4. **Target maintainability vs bytes** for decomposition? (Prefer maintainability; don’t block on micro-bundles.)

---

## Suggested experiment (optional, before committing to blobs)

1. Build a fixture desk: 30 JPEG stickies at current soft caps.
2. Measure: `performance.memory` (Chrome), load time, pan FPS, sticky keystroke latency, sync export size.
3. Compare to 30 text notes.
4. If load >2s or export >15 MB or typing jank, prioritize Phase 2.

No code was changed in this investigation.
