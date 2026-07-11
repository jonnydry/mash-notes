# Docx document reader (canvas drop + import)

**Date:** 2026-07-11  
**Status:** Approved design  
**Product:** Mash notes PWA

## Problem

Canvas external drops only accept markdown/plain text, Mash JSON, and PDF. Word documents (`.docx`) are common writing sources but currently land as “unsupported.” Users want to open them in a **read-only document viewer** (like the PDF reader) and **clip selected text** into stickies—not only dump extracted text as notes.

macOS Pages (`.pages`) is desirable later but is a proprietary package; it is **explicitly deferred**.

## Goals

1. Drop a `.docx` on the canvas → open a document reader overlay.
2. Select text in the reader → save an excerpt as a normal Mash note (view + text clip).
3. Open a `.docx` via **command palette** and **Settings** (not drop-only), matching PDF discoverability.
4. Keep the bundle light: convert with **mammoth**, lazy-load conversion + reader UI.
5. Share **reader chrome** with the PDF reader so both formats feel like one product surface.

## Non-goals

- Pages (`.pages`) import or preview (deferred; remains unsupported).
- Legacy `.doc`, RTF, ODT, Google Docs native formats.
- Region / image crop for Word (stays PDF-only).
- Pixel-perfect Word layout (columns, complex tables, tracked changes, headers/footers).
- Password-protected Office files.
- Editing the Word file in place or round-tripping back to `.docx`.

## Current behavior (baseline)

- Classification: `src/lib/external-file-drop.ts` (`note-text` | `json` | `pdf` | `unsupported`).
- Drop handler: `handleDroppedFiles` in `src/routes/+page.svelte` — notes import onto canvas; first PDF opens `PdfReader`.
- PDF path: lazy `PdfReader.svelte`, text + region clips, note `source: { kind: 'pdf', title, page }`, tags `pdf-clipping`.
- Entry points for PDF: canvas drop, hidden file input, palette “Open PDF reader…”.

## Approach (chosen)

**Lightweight HTML reader + shared document shell**

| Option | Summary | Decision |
|--------|---------|----------|
| **A (chosen)** | mammoth → clean HTML; shared shell; text clip | Ship this |
| B | High-fidelity `docx-preview`-style layout | Larger dep / more edge cases; not needed for notes workflow |
| C | Convert to stickies only (no viewer) | Rejected; user wants read-only viewer |

Pages strategy when revisited later: prefer embedded `Preview.pdf` → existing PDF pipeline; out of scope here.

## Architecture

### 1. Format detection

Extend `ExternalImportKind` and batch partition:

```ts
type ExternalImportKind = 'note-text' | 'json' | 'pdf' | 'docx' | 'unsupported';

type ExternalImportBatch = {
  noteTextFiles: File[];
  jsonFiles: File[];
  pdfFiles: File[];
  docxFiles: File[];
  unsupportedFiles: File[];
};
```

Recognition rules:

- Filename ends with `.docx` (case-insensitive), **or**
- MIME is `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

`.pages` stays `unsupported`.

### 2. Conversion module

New pure helper, e.g. `src/lib/docx-import.ts`:

- Input: `ArrayBuffer` or `File`
- Lazy-load `mammoth` inside the conversion path (not app startup)
- Output: `{ ok: true, html: string, title: string } | { ok: false, error: string }`
- Title: filename with `.docx` stripped, trimmed, fallback `Untitled document`
- Size guard: **8MB** max (same cap as JSON drop import); reject oversized files before parse
- Empty readable content → error (“No readable text in this document”)
- Mammoth options: convert structure to HTML; **v1 strips/omits embedded images** (no image conversion handlers). Images in the stage are a future enhancement.

No persistence of the original binary; session holds the `File` only while the reader is open (same as PDF).

### 3. Shared document reader shell

Extract **`DocumentReaderShell.svelte`** from current PDF chrome:

**Shell owns**

- Overlay layout (open/close, focus management patterns consistent with PDF)
- Header: document title / filename, close control
- Loading and error regions
- Session clippings strip + “open clippings on canvas”
- Text-selection affordance (“Save excerpt”) wiring via callbacks

**Shell does not own**

- PDF.js rendering, page/zoom, region crop
- mammoth conversion

**Consumers**

| Consumer | Stage content | Extra toolbar | Clip payload |
|----------|---------------|---------------|--------------|
| `PdfReader` | canvas + text layer | page, zoom, region mode | `{ page, text? }` or region image |
| `DocxReader` (thin) | scrollable HTML article | none (or simple font-size later) | `{ text }` |

Implementation note: prefer extracting shared UI from `PdfReader.svelte` rather than duplicating CSS/markup. Code-splitting: PDF engine and mammoth remain behind separate lazy import boundaries; shell may be imported by both reader entry points.

### 4. Docx reader entry

- Lazy loader parallel to `lazy-pdf-reader.ts` (e.g. `lazy-docx-reader.ts`)
- Props mirror PDF where applicable: `file`, `clippings`, `open`, `onClose`, `onClip`, `onOpenClippings`
- On mount / file change: convert → set HTML or error
- Render mammoth HTML with Mash typography tokens. **v1 trust model:** local user-chosen files only (drop / file picker), same as PDF; render mammoth output via a dedicated container without executing scripts. Do **not** add DOMPurify unless a later audit requires it.

### 5. App wiring (`+page.svelte`)

State parallel to PDF:

- `docxReaderFile`, `docxReaderOpen`, `docxClippings`, lazy component handle

Actions:

- `openDocxReader(file)` / `hideDocxReader()` / `resumeDocxReader()`
- `saveDocxClipping({ text })` → create note + session clipping list
- `handleDroppedFiles`: if `batch.docxFiles.length > 0`, open first; additional docx count toward skipped (same multi-PDF rule)
- Hidden `<input type="file" accept=".docx,application/vnd...">` with test id
- Command palette: **“Open Word document…”**
- Settings: entry next to other import actions that triggers the same input

Toast copy updates when nothing supported:

> Drop a PDF, Word (.docx), text note, or Mash JSON file

### 6. Note model / clips

Extend note `source` (see `types.ts` + import validation in `import-notes.ts`) with:

```ts
| { kind: 'docx'; title: string }
```

Clip notes:

- `tags` include `docx-clipping`
- `title` from first ~72 chars of excerpt (reuse or twin of `pdfClippingTitle`)
- `body` = excerpt text (normalized whitespace, max length parallel to PDF ~12k)
- No page field

Sync/export: treat as normal notes; validation must accept the new source kind on re-import.

## Data flow

```text
Drop / Settings / Palette
        │
        ▼
 externalImportKind → 'docx'
        │
        ▼
 openDocxReader(File)
        │
        ▼
 arrayBuffer → mammoth → HTML  ──error──► shell error + toast
        │
        ▼
 DocumentReaderShell + HTML stage
        │
 user selects text → Save excerpt
        │
        ▼
 createNote(source: { kind: 'docx', title }, tags: docx-clipping)
        │
        ▼
 session clippings list; optional place on canvas
```

Mixed drops (normative):

1. Always process note-text and JSON as today.
2. Open **at most one** document overlay per drop.
3. If any PDF is present, open the first PDF (extra PDFs skipped).
4. Else if any docx is present, open the first docx (extra docx skipped).
5. Unsupported files (including `.pages`) only affect the skip count.

## Error handling

| Case | User-visible result |
|------|---------------------|
| Unsupported extension (incl. `.pages`) | Skipped; summary toast counts skipped |
| Corrupt / non-OOXML | “Couldn’t open this Word document” |
| Empty conversion | “No readable text in this document” |
| Oversize | Skip + toast |
| Conversion throw | Log + open error state |
| Clip with empty selection | No-op / disable Save |

## Testing

1. **Unit — detection** (`external-file-drop.spec.ts`): `.docx`, MIME, mixed batch includes `docxFiles`; `.pages` unsupported.
2. **Unit — conversion** (`docx-import.spec.ts`): minimal fixture `.docx` (checked-in tiny OOXML or generated in test) produces HTML containing expected text; empty/oversize fail.
3. **Unit — source validation**: imported notes with `source.kind === 'docx'` round-trip through `normalizeImportedNote` / parse if applicable.
4. **E2E**: file input → reader visible with document title; optional clip path if selection is automatable; drop of unsupported still shows skip messaging.
5. **Regression**: existing PDF e2e and text-file drop e2e still pass after shell extraction.

## Dependency

- Add **`mammoth`** as a runtime dependency (lazy-imported only on docx open).
- No new server or native modules; remains a static PWA.

## Implementation sketch (PR order)

1. Detection + toast strings + unit tests (no UI).
2. `docx-import` + mammoth + unit tests with fixture.
3. Extract `DocumentReaderShell`; refactor `PdfReader` to use it (no behavior change).
4. `DocxReader` + lazy load + clip helpers + source type.
5. Wire `+page.svelte` (drop, input, palette, Settings).
6. E2E + README one-liner under “What’s in the app”.

## Future (out of scope)

- Pages via embedded `Preview.pdf`.
- Docx images in the HTML stage.
- Settings “always open dropped Word as note” preference.
- Unified “Open document…” picker accepting PDF + docx.

## Success criteria

- Dropping a real `.docx` opens a readable overlay without leaving the desk.
- Selected text becomes a sticky with `docx-clipping` and `source.kind === 'docx'`.
- Palette and Settings can open the same flow.
- PDF reader still works after shell extraction.
- Pages still unsupported; no false “importing…” for `.pages` alone.
- `npm run ci` green.
