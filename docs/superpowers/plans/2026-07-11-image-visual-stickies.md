# Image Visual Stickies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drop, paste, or open PNG/JPEG/WebP/GIF files as image-forward visual stickies on the desk, with soft resize and multi-image set placement.

**Architecture:** Extend `ExternalImportKind` with `image`; prepare pixels in `desk-image.ts` (decode, soft resize, data URL body + `source.kind === 'image'`); place notes like paste multi-cards; wire drop/paste/palette/Settings. Reuse `parseEmbeddedNoteImage` canvas chrome.

**Tech Stack:** Svelte 5 + SvelteKit, TypeScript, Vitest, Playwright, browser canvas/`createImageBitmap` (no new deps).

**Spec:** `docs/superpowers/specs/2026-07-11-image-visual-stickies-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `src/lib/types.ts` | `NoteSource` += image |
| `src/lib/external-file-drop.ts` | Classify images; `imageFiles` batch |
| `src/lib/external-file-drop.spec.ts` | Detection + partition tests |
| `src/lib/desk-image.ts` | Prepare pipeline, body/title builders, caps |
| `src/lib/desk-image.spec.ts` | Unit tests for prepare + body |
| `src/lib/import-notes.ts` | Validate `source.kind === 'image'` |
| `src/lib/import-notes.spec.ts` | Round-trip provenance |
| `src/lib/board-image-export.ts` | Optional source label for image notes |
| `src/routes/+page.svelte` | Drop, paste, open, create cards |
| `src/lib/components/SettingsPanel.svelte` | Open image… action |
| `src/lib/components/CanvasBoard.svelte` | Source footer for `image` |
| `e2e/image-stickies.spec.ts` | Drop fixture PNG |
| `README.md` | Feature bullet |

---

### Task 1: Types + classify images

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/external-file-drop.ts`
- Modify: `src/lib/external-file-drop.spec.ts`
- Modify: `src/lib/import-notes.ts`
- Modify: `src/lib/import-notes.spec.ts`

- [ ] **Step 1: Extend NoteSource**

In `types.ts`, add to `NoteSource`:

```ts
| {
    kind: 'image';
    title: string;
  }
```

- [ ] **Step 2: Update classification tests**

In `external-file-drop.spec.ts`, expect png/jpeg/webp/gif → `image`; partition includes `imageFiles`; photo.png is no longer unsupported.

- [ ] **Step 3: Implement classification**

```ts
export type ExternalImportKind = 'note-text' | 'json' | 'pdf' | 'docx' | 'image' | 'unsupported';
// imageFiles: File[] in batch
// Match /\.(png|jpe?g|webp|gif)$/i or image/(png|jpeg|webp|gif)
```

- [ ] **Step 4: import-notes source validation**

Accept `source.kind === 'image'` with string title (same title slice as docx).

- [ ] **Step 5: Run unit tests; commit**

```bash
npm run test:unit -- --run src/lib/external-file-drop.spec.ts src/lib/import-notes.spec.ts
git commit -m "feat: classify image drops and image note source"
```

---

### Task 2: desk-image prepare pipeline

**Files:**
- Create: `src/lib/desk-image.ts`
- Create: `src/lib/desk-image.spec.ts`

- [ ] **Step 1: Write tests for pure helpers** (title from filename, body compose, caps, isImageFile without canvas)

- [ ] **Step 2: Implement `desk-image.ts`**

Exports:

```ts
export const DESK_IMAGE_MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const DESK_IMAGE_MAX_EDGE = 2400;
export const DESK_IMAGE_JPEG_QUALITY = 0.82;
export const DESK_IMAGE_MAX_PER_ACTION = 50;

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean;
export function imageTitleFromFileName(name: string): string;
export function imageNoteBody(dataUrl: string, alt: string, caption?: string): string;
export function imageNoteSource(title: string): { kind: 'image'; title: string };

export type PrepareDeskImageResult =
  | { ok: true; dataUrl: string; width: number; height: number; compacted: boolean; titleHint: string }
  | { ok: false; error: 'too-large' | 'undecodable' | 'unsupported' };

export async function prepareDeskImage(
  input: Blob,
  options?: { fileName?: string; titleHint?: string }
): Promise<PrepareDeskImageResult>;
```

Pipeline: reject size > 20MB; decode via createImageBitmap or Image; if max(w,h) > 2400 or need smaller encode, canvas re-encode (JPEG if no alpha, else PNG); GIF → still (first frame via bitmap); return data URL.

For unit tests that can't rely on real decode in all envs: test pure string helpers thoroughly; mock or skip bitmap-heavy tests if jsdom lacks full canvas—prefer testing size reject with a large Blob, and body/title helpers.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: prepare desk images with soft resize"
```

---

### Task 3: Wire drop, paste, open on the page

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/SettingsPanel.svelte`
- Modify: `src/lib/components/CanvasBoard.svelte` (image source footer)
- Modify: `src/lib/board-image-export.ts` if source labels needed

- [ ] **Step 1: Helper `createVisualStickiesFromFiles(files, origin: {x,y})`**

For each file (cap 50): `prepareDeskImage` → `createNote` with body/source → place in grid like paste. Collect compacted count, failures. Flash toasts per spec.

- [ ] **Step 2: `handleDroppedFiles`**

Include `imageFiles` in supportedCount; call create helper at drop x,y; update toast copy to mention images.

- [ ] **Step 3: Paste**

Before text paste: extract image from `clipboardData.files` or items; if image, preventDefault, prepare, caption = text/plain if any, create one card.

- [ ] **Step 4: imageInputEl + palette + Settings**

Hidden multi file input; Open image…; Settings button.

- [ ] **Step 5: Canvas source footer for `note.source?.kind === 'image'`**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: drop paste and open visual image stickies"
```

---

### Task 4: E2E + README

**Files:**
- Create: `e2e/image-stickies.spec.ts`
- Modify: `README.md`

- [ ] Drop 1×1 PNG via DataTransfer on canvas; expect card group by title.
- [ ] README bullet under What’s in the app.

```bash
npm run test:unit -- --run
npm run check
npx playwright test e2e/image-stickies.spec.ts
git commit -m "test: e2e coverage for image visual stickies"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Classify image files | 1 |
| NoteSource image | 1 |
| Soft resize / caps | 2 |
| Body + source composition | 2 |
| Drop multi set | 3 |
| Paste image + text | 3 |
| Palette / Settings open | 3 |
| Image-forward cards | existing CanvasBoard + source footer 3 |
| E2E / README | 4 |
| Explode GIF | out of scope |
