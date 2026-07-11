# Image visual stickies (canvas drop, paste, open)

**Date:** 2026-07-11  
**Status:** Approved design (pending user review of written spec)  
**Product:** Mash notes PWA  
**Season:** Intake expansion — **Images → Links → Documents** (this doc is Images only)

## Problem

Canvas external drops accept markdown/plain text, Mash JSON, PDF, and docx. Screenshots and photos land as “unsupported.” Users want images on the desk as **visual ingredients** they can arrange, mash, and take via Finish—not a gallery app and not a deferred attachment on a text note.

PDF region clippings already prove the path: notes with a leading `![…](data:image/…)` body, safe markdown rendering, rotate, board/PDF export. Standalone images should extend that pattern with discoverable intake (drop, paste, open).

## Goals

1. Drop one or more images on the canvas → **visual stickies** near the drop point (multi = a set).
2. Paste a clipboard image → one visual sticky; if text is also present, put that text under the image on the **same** card.
3. Open image(s) via **command palette** and **Settings** (not drop-only), matching PDF/docx discoverability.
4. Soft-compact large images for desk/sync health; reject only extremes, with clear feedback.
5. Reuse existing note/export/sync machinery—no parallel media store in v1.

## Non-goals (v1)

- Albums / multi-image single card
- Crop UI, filters, OCR, camera capture
- Animated GIF **playback** as a product feature
- **Explode GIF into frame cards** (explicit follow-on; see below)
- HEIC/HEIF, SVG, BMP, TIFF, AVIF as first-class formats
- Separate IndexedDB/OPFS blob store (future if desks grow heavy)
- External `http(s)` image URLs as stored pixels
- Auto tag `image` (provenance via `source` only)
- Tables/CSV intake, URL source cards, Pages/EPUB (later season slices)

## Decisions (from design dialogue)

| Topic | Choice |
|--------|--------|
| Season order | Images → Links → Documents |
| Card metaphor | **Visual sticky** (image-forward face, optional caption) |
| Architecture | Extend PDF-clipping-style embedded data URLs in note body |
| Entry points | Drop + paste + palette/Settings open |
| Resize | Soft cap + gentle resize; hard reject only extremes |
| Multi-image | One card per image; cascade/grid set near origin |
| Tags | **Source-only** — no auto `image` tag |
| Clipboard image+text | One card: image + text body (composed, not pick-a-winner) |
| Explode GIF | Deferred sequel |

## Approach

**Extend the visual-note pattern (chosen)**

| Option | Summary | Decision |
|--------|---------|----------|
| **A (chosen)** | Note body holds `![alt](dataUrl)`; `source.kind === 'image'`; soft resize; multi-card place | Ship this |
| B | Separate blob table + note refs | Deferred; heavier sync/export |
| C | Session-only object URLs | Rejected; breaks local-first |

## Product shape

### Success criteria

1. Drop PNG/JPEG/WebP/GIF → visual card(s) on the active desk.
2. Paste screenshot → one visual card; paste image+text → one card with both.
3. Palette/Settings **Open image…** places card(s) at viewport center (or existing “no drop point” convention).
4. Select, mash, peel, Finish, JSON/sync/markdown/board export work without special-casing a second storage system.
5. Large images toast “Image resized for the desk”; oversized originals rejected with a clear message.

### What a visual sticky is

A normal `Note` + `CanvasItem` placement:

| Field | Behavior |
|--------|----------|
| `title` | Filename without extension; clipboard defaults: `Screenshot` / `Pasted image`. Truncate ~200 chars (paste parity). |
| `body` | Leading markdown image + optional caption/text: `![title](data:image/…)\n\n` + optional text. Same shape as PDF region clips so `parseEmbeddedNoteImage`, rotate, board export, sequence PDF keep working. |
| `source` | `{ kind: 'image'; title: string }` — display/filename title or `Clipboard`. |
| `tags` | Unchanged by import (no auto tag). |
| session/scope | Same as any new card on the active desk. |

**Canvas chrome:** Image-forward preview (large image, title secondary)—not a wall of raw markdown. Prefer `source.kind === 'image'` for chrome; pixels remain in body.

**Editor:** Image + editable caption/body after the image block.

**Mash / set operators:** Treat as ordinary notes. No special image-mash product in v1; mashed bodies may contain embedded images as today.

**Sync / export:** Data URL in body rides existing JSON, sync bundles, markdown, Finish paths. Soft resize exists so multi-image desks stay practical.

## Entry points & classification

### File recognition

| Signal | Kind |
|--------|------|
| Extension `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` (case-insensitive) | `image` |
| MIME `image/png`, `image/jpeg`, `image/webp`, `image/gif` | `image` |

**v1 unsupported** (named feedback, no silent fail): HEIC/HEIF, SVG, BMP, TIFF, AVIF, and anything else.

Extend:

```ts
type ExternalImportKind = 'note-text' | 'json' | 'pdf' | 'docx' | 'image' | 'unsupported';

type ExternalImportBatch = {
  noteTextFiles: File[];
  jsonFiles: File[];
  pdfFiles: File[];
  docxFiles: File[];
  imageFiles: File[];
  unsupportedFiles: File[];
};
```

### Canvas drop

- Images → visual stickies at drop point (multi = set layout). **No document reader** for images.
- Mixed drops: each kind keeps its path (images → cards, PDF/docx → readers, text/json → existing).
- Unsupported files: list by name in feedback.

### Clipboard paste

| Clipboard content | Behavior |
|-------------------|----------|
| Image only | One visual sticky after prepare pipeline |
| Text only | Existing paste split dialog / cards flow |
| **Image + text** | **One** visual sticky: prepared image + text under it (composed as if mashed) |
| Neither | No-op |

Title for image+text: default image title (`Pasted image` / `Screenshot`); full text goes in body under the image. Optional later polish: first-line title heuristics—not required for v1.

Implementation notes: inspect `clipboardData.files` / `items` for `image/*` before treating paste as plain text.

### Open via palette / Settings

- Command: **Open image…** (parallel to PDF/docx).
- Settings: import row that triggers the same hidden file input.
- `accept` appropriate image MIME/extensions; **multiple** selection where the OS allows.
- Placement origin: viewport center / last desk focus (same as other non-drop opens).

### Feedback copy (plain language)

- Compacted: `Image resized for the desk` (or `N images resized…` if batch).
- Hard reject: `Image too large to import (max 20 MB)`.
- Unsupported: `Can't import [name] — try PNG, JPEG, WebP, or GIF`.
- Cap: `Imported 50 of N images`.
- Corrupt: skip file, continue others, name in toast/error.

## Soft resize pipeline

Module e.g. `src/lib/desk-image.ts`:

`prepareDeskImage(input: Blob | File) →`

```ts
| { ok: true; dataUrl: string; width: number; height: number; compacted: boolean; titleHint: string }
| { ok: false; error: 'too-large' | 'undecodable' | 'unsupported' }
```

| Step | Rule |
|------|------|
| Hard reject | Original **> 20 MB** when size is known |
| Decode | Browser-native (`createImageBitmap` / `Image`) |
| Soft compact | If max edge **> ~2400px** or re-encode needed for size, draw to canvas and re-encode |
| Output | **JPEG ~0.82** when no alpha; **PNG** when transparency needed; loop quality/dimensions if still huge |
| GIF (v1) | **Still only** — first frame (or keep small single-frame-friendly file under budget). No animation playback. No frame explosion. |
| Constants | Single module export for max bytes, max edge, quality, multi-import cap |

## Multi-image layout & caps

- **One image → one card** at origin.
- **N images → N cards** as a set near origin: compact cascade or small grid via shared helper (reuse/extend `spreadSetMoves` / cascade constants; one “place drafts as set” path for future multi-intake).
- Order: stable file-list / selection order.
- **Max 50 images per drop/open action**; import first 50 + toast for remainder.
- **Undo:** Prefer one undo step for the whole multi-image create when canvas undo supports batch; otherwise match multi-paste behavior.

## Architecture

| Piece | Role |
|--------|------|
| `types.ts` | `NoteSource` += `{ kind: 'image'; title: string }` |
| `external-file-drop.ts` | `image` kind + batch partition |
| `desk-image.ts` (new) | MIME/ext helpers, `prepareDeskImage`, body/title builders, GIF still policy |
| Paste path (`+page.svelte` / paste helpers) | Image(+text) vs text-only branch |
| Drop / open wiring | Create notes + placements; palette + Settings + hidden input |
| Card UI | Image-forward chrome for `source.kind === 'image'` (and/or embedded image parse) |
| Existing | `markdown.ts` data-URL safety, `image-rotate.ts`, board/sequence export, Finish |

**Not in v1:** new Dexie tables, blob refs, service worker image cache.

## Error & edge cases

- Corrupt / undecodable → skip that file; continue batch; name in feedback.
- Cancel file picker → no-op.
- Empty image after filter → no-op.
- Storage quota / write failure → follow existing storage-health / user-visible error patterns; avoid silent partial success when a single atomic batch is expected.
- Very wide/tall images → max-edge resize preserves aspect ratio.

## Testing

**Unit**

- `externalImportKind` / batch split for image extensions and MIME.
- `prepareDeskImage`: reject oversize; compact large dimensions; preserve small images (`compacted: false` when possible).
- Body composition: image-only; image+text caption.
- Title from filename and clipboard defaults.

**E2E**

- Drop fixture PNG → card appears on desk (and optional source/title assertion).
- Open image via palette if stable in Playwright.
- Clipboard image paste: unit-prefer if CI clipboard is flaky; e2e optional.

## Follow-ons (out of this implementation)

### Explode GIF (charm sequel)

When an **animated** GIF is dropped or pasted, optionally split into **individual frame cards** as a set (not playback on one sticky).

- Dialog or command: **One still** vs **Frames as a set** (paste-split energy).
- Caps: e.g. max 24–36 frames; even sampling if longer; soft-resize each frame.
- Source metadata: frame index + parent filename.
- Depends on: solid multi-card placement from Images v1 + a real frame decoder.

**v1 behavior until then:** still/first-frame only.

### Links (next season slice)

Paste URL → source card with title/provenance. Dual-clipboard composition rules from Images teach “one card from mixed clipboard.”

### Documents (later)

Additional document kinds + shared reader shell; images remain **cards, not readers**.

### Blob store (if needed)

If multi-image desks bloat sync bundles, introduce blob table without changing visual-sticky UX.

## Implementation outline (for later plan)

1. Types + classification tests.
2. `desk-image.ts` prepare pipeline + body helpers + tests.
3. Drop path creates visual stickies + multi layout.
4. Paste image / image+text path.
5. Palette + Settings open + file input.
6. Image-forward card chrome polish.
7. E2E fixture drop.
8. Docs: README “What’s in the app” bullet for images.

## Spec self-review checklist

- [x] No TBD placeholders for v1 decisions
- [x] Non-goals and explode-GIF sequel explicit
- [x] Architecture matches product (embedded data URL, not blobs)
- [x] Clipboard image+text composition explicit
- [x] Caps and resize numbers stated (tunable constants)
- [x] Scope limited to Images; Links/Docs only as handoff
