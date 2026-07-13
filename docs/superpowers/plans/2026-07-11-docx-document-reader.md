# Docx Document Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open `.docx` files from canvas drop, Settings, or the command palette in a read-only document reader (shared chrome with PDF) and clip selected text into stickies.

**Architecture:** Extend external-file-drop classification with `docx`; convert via lazy-loaded `mammoth` in `docx-import.ts`; extract shared `DocumentReaderShell` from `PdfReader`; add thin `DocxReader` for HTML stage + text clips; wire app state parallel to the PDF path; extend `NoteSource` for docx provenance.

**Tech Stack:** Svelte 5 + SvelteKit, TypeScript, Vitest, Playwright, mammoth (new), existing PdfReader patterns.

**Spec:** `docs/superpowers/specs/2026-07-11-docx-document-reader-design.md`

---

## File map

| File                                            | Responsibility                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `src/lib/external-file-drop.ts`                 | Classify `.docx` / Office MIME; partition `docxFiles`                     |
| `src/lib/external-file-drop.spec.ts`            | Detection + batch tests                                                   |
| `src/lib/docx-import.ts`                        | Size guard, title, mammoth → HTML (images omitted)                        |
| `src/lib/docx-import.spec.ts`                   | Conversion success/fail cases                                             |
| `src/lib/docx-clipping.ts`                      | Excerpt normalize/title helpers + clip types                              |
| `src/lib/docx-clipping.spec.ts`                 | Title/excerpt unit tests                                                  |
| `src/lib/types.ts`                              | `NoteSource` union includes docx                                          |
| `src/lib/import-notes.ts`                       | Validate `source.kind === 'docx'` on JSON import                          |
| `src/lib/import-notes.spec.ts`                  | Provenance round-trip                                                     |
| `src/lib/components/DocumentReaderShell.svelte` | Shared overlay chrome (header shell, clippings rail, loading/error slots) |
| `src/lib/components/PdfReader.svelte`           | Refactor to use shell; keep PDF stage + region crop                       |
| `src/lib/components/DocxReader.svelte`          | HTML stage + text selection → clip                                        |
| `src/lib/lazy-docx-reader.ts`                   | Dynamic import boundary                                                   |
| `src/routes/+page.svelte`                       | State, drop, save clip, palette, hidden input, return chip                |
| `src/lib/components/SettingsPanel.svelte`       | “Open Word document…” action                                              |
| `e2e/docx-reader.spec.ts`                       | Open reader + clip excerpt                                                |
| `README.md`                                     | One-line feature mention                                                  |
| `package.json`                                  | `mammoth` dependency                                                      |

---

### Task 1: Classify docx in external file drops

**Files:**

- Modify: `src/lib/external-file-drop.ts`
- Modify: `src/lib/external-file-drop.spec.ts`

- [ ] **Step 1: Write failing detection tests**

In `src/lib/external-file-drop.spec.ts`, replace/extend the existing suite so it covers docx and pages:

```ts
import { describe, expect, it } from 'vitest';
import {
	detectJsonImportKind,
	externalImportKind,
	splitExternalImportFiles
} from './external-file-drop';

function file(name: string, type = ''): File {
	return new File(['content'], name, { type });
}

describe('external file drops', () => {
	it('recognizes note text, JSON, PDF, docx, and unsupported files', () => {
		expect(externalImportKind(file('idea.md'))).toBe('note-text');
		expect(externalImportKind(file('idea.MARKDOWN'))).toBe('note-text');
		expect(externalImportKind(file('scratch.txt', 'text/plain'))).toBe('note-text');
		expect(externalImportKind(file('notes.json'))).toBe('json');
		expect(externalImportKind(file('export', 'application/json'))).toBe('json');
		expect(externalImportKind(file('paper.pdf', 'application/pdf'))).toBe('pdf');
		expect(externalImportKind(file('brief.docx'))).toBe('docx');
		expect(externalImportKind(file('Brief.DOCX'))).toBe('docx');
		expect(
			externalImportKind(
				file('memo', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
			)
		).toBe('docx');
		expect(externalImportKind(file('essay.pages'))).toBe('unsupported');
		expect(externalImportKind(file('photo.png', 'image/png'))).toBe('unsupported');
	});

	it('partitions mixed file drops without losing order within a format', () => {
		const a = file('a.md');
		const b = file('b.json');
		const c = file('c.pdf');
		const d = file('d.txt');
		const e = file('e.docx');
		expect(splitExternalImportFiles([a, b, c, d, e])).toEqual({
			noteTextFiles: [a, d],
			jsonFiles: [b],
			pdfFiles: [c],
			docxFiles: [e],
			unsupportedFiles: []
		});
	});

	it('distinguishes note exports from sync bundles', () => {
		expect(detectJsonImportKind('[{"id":"one"}]')).toBe('notes');
		expect(detectJsonImportKind('{"version":3,"notes":[],"desk":{}}')).toBe('sync');
		expect(detectJsonImportKind('{"notes":[]}')).toBe('invalid');
		expect(detectJsonImportKind('not json')).toBe('invalid');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/lib/external-file-drop.spec.ts`

Expected: FAIL — `docx` not a valid kind / missing `docxFiles`.

- [ ] **Step 3: Implement classification**

Replace `src/lib/external-file-drop.ts` with:

```ts
export type ExternalImportKind = 'note-text' | 'json' | 'pdf' | 'docx' | 'unsupported';

export type ExternalImportBatch = {
	noteTextFiles: File[];
	jsonFiles: File[];
	pdfFiles: File[];
	docxFiles: File[];
	unsupportedFiles: File[];
};

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Formats Mash can safely turn into notes or an existing validated import. */
export function externalImportKind(file: Pick<File, 'name' | 'type'>): ExternalImportKind {
	const name = file.name.trim().toLowerCase();
	const type = file.type.toLowerCase();
	if (/\.(md|markdown|txt)$/.test(name)) return 'note-text';
	if (/\.json$/.test(name) || type === 'application/json') return 'json';
	if (/\.pdf$/.test(name) || type === 'application/pdf') return 'pdf';
	if (/\.docx$/.test(name) || type === DOCX_MIME) return 'docx';
	return 'unsupported';
}

export function splitExternalImportFiles(files: File[]): ExternalImportBatch {
	const batch: ExternalImportBatch = {
		noteTextFiles: [],
		jsonFiles: [],
		pdfFiles: [],
		docxFiles: [],
		unsupportedFiles: []
	};
	for (const file of files) {
		const kind = externalImportKind(file);
		if (kind === 'note-text') batch.noteTextFiles.push(file);
		else if (kind === 'json') batch.jsonFiles.push(file);
		else if (kind === 'pdf') batch.pdfFiles.push(file);
		else if (kind === 'docx') batch.docxFiles.push(file);
		else batch.unsupportedFiles.push(file);
	}
	return batch;
}

/** JSON arrays are note exports; versioned objects with notes are sync bundles. */
export function detectJsonImportKind(text: string): 'notes' | 'sync' | 'invalid' {
	try {
		const value: unknown = JSON.parse(text);
		if (Array.isArray(value)) return 'notes';
		if (
			typeof value === 'object' &&
			value !== null &&
			'version' in value &&
			'notes' in value &&
			Array.isArray((value as { notes?: unknown }).notes)
		) {
			return 'sync';
		}
		return 'invalid';
	} catch {
		return 'invalid';
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/lib/external-file-drop.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/external-file-drop.ts src/lib/external-file-drop.spec.ts
git commit -m "feat: classify docx files in external drops"
```

---

### Task 2: mammoth conversion module

**Files:**

- Create: `src/lib/docx-import.ts`
- Create: `src/lib/docx-import.spec.ts`
- Modify: `package.json` / lockfile via npm

- [ ] **Step 1: Install mammoth**

```bash
npm install mammoth
```

Confirm `mammoth` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write failing conversion tests**

Create `src/lib/docx-import.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { convertDocxToHtml, docxTitleFromFileName, MAX_DOCX_BYTES } from './docx-import';

/** Minimal OOXML package with one paragraph (zip of [Content_Types] + word/document.xml). */
async function minimalDocxBuffer(paragraphText: string): Promise<ArrayBuffer> {
	// Use mammoth's transitive JSZip if available; otherwise dynamic import after install.
	const JSZip = (await import('jszip')).default;
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	);
	zip.folder('_rels')?.file(
		'.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
	);
	const escaped = paragraphText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	zip.folder('word')?.file(
		'document.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`
	);
	const bytes = await zip.generateAsync({ type: 'arraybuffer' });
	return bytes;
}

describe('docx-import', () => {
	it('derives a title from the filename', () => {
		expect(docxTitleFromFileName('Brief Notes.DOCX')).toBe('Brief Notes');
		expect(docxTitleFromFileName('  ')).toBe('Untitled document');
	});

	it('converts a minimal docx to HTML containing the paragraph text', async () => {
		const buffer = await minimalDocxBuffer('Hello from Word');
		const result = await convertDocxToHtml(buffer, 'hello.docx');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.title).toBe('hello');
			expect(result.html).toContain('Hello from Word');
		}
	});

	it('rejects oversized files', async () => {
		const huge = new ArrayBuffer(MAX_DOCX_BYTES + 1);
		const result = await convertDocxToHtml(huge, 'big.docx');
		expect(result).toEqual({
			ok: false,
			error: 'This Word document is too large to open (max 8MB).'
		});
	});

	it('rejects empty / unreadable conversion output', async () => {
		const buffer = await minimalDocxBuffer('');
		const result = await convertDocxToHtml(buffer, 'empty.docx');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/No readable text/i);
		}
	});

	it('rejects corrupt bytes', async () => {
		const corrupt = new TextEncoder().encode('not a zip').buffer;
		const result = await convertDocxToHtml(corrupt, 'bad.docx');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/Couldn.?t open this Word document/i);
		}
	});
});
```

If `jszip` is not a direct dependency, either:

```bash
npm install -D jszip
```

or pin the test to import JSZip from mammoth’s nested path only if the above fails — prefer adding `jszip` as a **devDependency** for fixture generation.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit -- --run src/lib/docx-import.spec.ts`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `docx-import.ts`**

Create `src/lib/docx-import.ts`:

```ts
export const MAX_DOCX_BYTES = 8_000_000;

export type DocxConvertResult =
	{ ok: true; html: string; title: string } | { ok: false; error: string };

export function docxTitleFromFileName(name: string): string {
	const base = name.replace(/\.docx$/i, '').trim();
	return base || 'Untitled document';
}

function stripTagsToText(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Convert a local user-chosen .docx ArrayBuffer to HTML via mammoth.
 * Images are omitted (v1). Lazy-loads mammoth so it stays out of the main bundle path.
 */
export async function convertDocxToHtml(
	buffer: ArrayBuffer,
	fileName: string
): Promise<DocxConvertResult> {
	const title = docxTitleFromFileName(fileName);
	if (buffer.byteLength > MAX_DOCX_BYTES) {
		return { ok: false, error: 'This Word document is too large to open (max 8MB).' };
	}
	if (buffer.byteLength === 0) {
		return { ok: false, error: 'Couldn’t open this Word document.' };
	}
	try {
		const mammoth = await import('mammoth');
		const result = await mammoth.convertToHtml(
			{ arrayBuffer: buffer },
			{
				// Omit images in v1 — no convertImage handler / ignore media.
				includeDefaultStyleMap: true
			}
		);
		const html = (result.value ?? '').trim();
		if (!html || !stripTagsToText(html)) {
			return { ok: false, error: 'No readable text in this document.' };
		}
		return { ok: true, html, title };
	} catch (cause) {
		console.error(cause);
		return { ok: false, error: 'Couldn’t open this Word document.' };
	}
}
```

Notes for implementer:

- Check mammoth’s actual API for image omission; if images still emit `<img src="data:...">` by default, pass options that skip them (mammoth docs: custom `convertImage` returning empty, or style map). Goal: no heavy embedded images in HTML.
- If TypeScript complains about mammoth types, add `// @ts-expect-error` only if needed, or rely on bundled types.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- --run src/lib/docx-import.spec.ts`

Expected: PASS. Fix empty-paragraph case if mammoth still returns whitespace-only HTML with empty tags — adjust `stripTagsToText` / empty check as needed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/docx-import.ts src/lib/docx-import.spec.ts
git commit -m "feat: convert docx to HTML with mammoth"
```

---

### Task 3: Note source + clip helpers

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/lib/import-notes.ts`
- Modify: `src/lib/import-notes.spec.ts`
- Create: `src/lib/docx-clipping.ts`
- Create: `src/lib/docx-clipping.spec.ts`

- [ ] **Step 1: Write failing tests for source validation and clip helpers**

Add to `src/lib/import-notes.spec.ts`:

```ts
it('preserves validated docx provenance', () => {
	const json = JSON.stringify([
		{
			id: 'docx-note',
			title: 'Useful excerpt',
			body: 'Selected text',
			folder: '',
			tags: ['docx-clipping'],
			created: 1,
			modified: 2,
			pinned: 0,
			source: { kind: 'docx', title: 'brief.docx' }
		}
	]);
	const result = parseNotesJson(json);
	expect(result.ok).toBe(true);
	if (result.ok) {
		expect(result.notes[0].source).toEqual({ kind: 'docx', title: 'brief.docx' });
	}
});
```

Create `src/lib/docx-clipping.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { docxClippingTitle, normalizeDocxExcerpt } from './docx-clipping';

describe('docx-clipping', () => {
	it('normalizes whitespace and caps length', () => {
		expect(normalizeDocxExcerpt('  hello   world  ')).toBe('hello world');
		expect(normalizeDocxExcerpt('x'.repeat(20_000)).length).toBe(12_000);
	});

	it('builds a short title from excerpt text', () => {
		expect(docxClippingTitle('First sentence. More.')).toBe('First sentence');
		expect(docxClippingTitle('')).toBe('Word excerpt');
	});
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npm run test:unit -- --run src/lib/import-notes.spec.ts src/lib/docx-clipping.spec.ts`

Expected: FAIL

- [ ] **Step 3: Implement types, validation, helpers**

In `src/lib/types.ts`, change:

```ts
export type NoteSource =
	| {
			kind: 'pdf';
			title: string;
			page: number;
	  }
	| {
			kind: 'docx';
			title: string;
	  };
```

In `src/lib/import-notes.ts`, replace the `source` block inside `normalizeImportedNote` with:

```ts
const sourceRaw = isRecord(raw.source) ? raw.source : null;
let source: Note['source'] | undefined;
if (
	sourceRaw?.kind === 'pdf' &&
	typeof sourceRaw.title === 'string' &&
	typeof sourceRaw.page === 'number' &&
	Number.isFinite(sourceRaw.page)
) {
	source = {
		kind: 'pdf',
		title: sourceRaw.title.trim().slice(0, 300),
		page: Math.max(1, Math.floor(sourceRaw.page))
	};
} else if (sourceRaw?.kind === 'docx' && typeof sourceRaw.title === 'string') {
	source = {
		kind: 'docx',
		title: sourceRaw.title.trim().slice(0, 300) || 'Untitled document'
	};
}
```

(Keep the rest of the return object using `source` as today.)

Create `src/lib/docx-clipping.ts`:

```ts
export type DocxClipping = {
	id: string;
	noteId: string;
	text: string;
};

export type DocxClipPayload = {
	text: string;
};

export function normalizeDocxExcerpt(text: string, maxLength = 12_000): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function docxClippingTitle(text: string): string {
	const clean = normalizeDocxExcerpt(text, 200);
	if (!clean) return 'Word excerpt';
	const sentence = clean.match(/^(.{1,72}?)(?:[.!?](?:\s|$)|$)/)?.[1] ?? clean.slice(0, 72);
	return sentence.trim().replace(/[,:;\s]+$/, '') || 'Word excerpt';
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm run test:unit -- --run src/lib/import-notes.spec.ts src/lib/docx-clipping.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/import-notes.ts src/lib/import-notes.spec.ts src/lib/docx-clipping.ts src/lib/docx-clipping.spec.ts
git commit -m "feat: docx note source and clipping helpers"
```

---

### Task 4: Extract `DocumentReaderShell` and refactor `PdfReader`

**Files:**

- Create: `src/lib/components/DocumentReaderShell.svelte`
- Modify: `src/lib/components/PdfReader.svelte`

Goal: PDF e2e (`e2e/pdf-reader.spec.ts`) still passes with no behavior change. Extract **chrome only** — outer layout, clippings rail structure, shared CSS class names can stay `mash-pdf-*` initially if renaming risks churn; prefer introducing neutral `mash-doc-reader` classes only where both readers share them, **or** keep `mash-pdf-*` class names on the shell for CSS reuse and pass `ariaLabel` / clippings copy as props.

Recommended shell props (snippet):

```ts
interface Props {
	open?: boolean;
	fileName: string;
	ariaLabel: string;
	clippingsLabel: string; // e.g. "PDF clippings" / "Word clippings"
	clippingsCountLabel: string; // e.g. "3 saved from this PDF"
	emptyClippingsHint: string;
	emptyClippingsSubhint?: string;
	loading?: boolean;
	error?: string;
	onClose: () => void;
	onOpenClippings?: () => void;
	clippings: Array<{
		id: string;
		text: string;
		meta?: string; // "p. 2" for PDF; omit for docx
		imageDataUrl?: string;
	}>;
	/** Toolbar controls between filename and close (page/zoom/region for PDF). */
	children?: import('svelte').Snippet;
	/** Main stage content. */
	stage: import('svelte').Snippet;
}
```

Use Svelte 5 snippets: `{#snippet toolbar()}...{/snippet}` from PdfReader, or named slots pattern consistent with the codebase.

- [ ] **Step 1: Read full `PdfReader.svelte` markup + styles**

Read the entire file (markup ~457–end and all CSS). Identify:

- Outer `<section class="mash-pdf-reader">`
- Header toolbar (file name + close must live in shell; PDF-specific controls stay in a toolbar snippet)
- Stage section wrapper
- Clippings `<aside>`

- [ ] **Step 2: Create shell with copied chrome**

Create `DocumentReaderShell.svelte` that renders:

1. Outer section with `class:is-hidden={!open}`, `aria-label={ariaLabel}`
2. Main column: header (file icon + `fileName` + **snippet for extra toolbar** + close button calling `onClose`)
3. Stage region containing **stage snippet**, plus optional error/loading overlays if driven by props
4. Clippings aside using generic clipping list (text / optional image / optional meta)

Move shared CSS into the shell (or import a shared stylesheet block). PdfReader should import/use the shell and only keep PDF-specific CSS (text layer, region rect, etc.).

- [ ] **Step 3: Refactor PdfReader to use the shell**

Minimal behavioral change:

- Pass `ariaLabel="PDF reader"`
- Pass clippings mapped to shell shape (`meta: \`p. ${page}\``)
- Keep save-excerpt UI **inside the stage** (positioned over the page) — shell does not own floating save buttons
- Keep region crop fully inside PdfReader stage

- [ ] **Step 4: Regression check PDF unit/e2e locally**

```bash
npm run test:unit -- --run
npx playwright test e2e/pdf-reader.spec.ts
```

Expected: PDF reader e2e still green. Fix any selector breakage (`role=region` name `PDF reader` must remain).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/DocumentReaderShell.svelte src/lib/components/PdfReader.svelte
git commit -m "refactor: extract shared document reader shell"
```

---

### Task 5: `DocxReader` component + lazy loader

**Files:**

- Create: `src/lib/components/DocxReader.svelte`
- Create: `src/lib/lazy-docx-reader.ts`

- [ ] **Step 1: Create lazy loader**

`src/lib/lazy-docx-reader.ts`:

```ts
/** Keep mammoth + reader UI behind a lazy boundary. */
export async function loadDocxReader() {
	return (await import('$lib/components/DocxReader.svelte')).default;
}
```

- [ ] **Step 2: Implement DocxReader**

Create `src/lib/components/DocxReader.svelte` with this behavior:

```ts
// Props
interface Props {
	file: File;
	clippings: import('$lib/docx-clipping').DocxClipping[];
	open?: boolean;
	onClose: () => void;
	onClip: (excerpt: import('$lib/docx-clipping').DocxClipPayload) => void | Promise<void>;
	onOpenClippings: (noteIds: string[]) => void | Promise<void>;
}
```

On mount / when `file` changes:

1. `loading = true`, clear error
2. `const buffer = await file.arrayBuffer()`
3. `const result = await convertDocxToHtml(buffer, file.name)`
4. On success set `html = result.html`; on failure set `error = result.error`
5. `loading = false`

Stage content:

- A scrollable article container with `data-testid="docx-reader-stage"`
- Render HTML via `{@html html}` only after successful convert (local user file trust model per spec)
- `onpointerup` / `mouseup` → read `window.getSelection()`, `normalizeDocxExcerpt`, if non-empty show “Save excerpt” button near selection (same pattern as PDF `captureSelection` + floating button)
- Save calls `onClip({ text: selectionText })`

Shell usage:

- `ariaLabel="Word document reader"`
- `clippingsLabel="Word clippings"`
- Count label: `${n} saved from this document`
- Empty hint: `Select text to capture an excerpt.`
- Map clippings without page meta

CSS: reuse shell; add `.mash-docx-article` with readable max-width (~42rem), padding, Mash ink/muted colors for headings/paragraphs/lists from mammoth tags (`p`, `h1`–`h6`, `ul`, `ol`, `strong`, `em`, `a`).

- [ ] **Step 3: Manual smoke (optional in agent session)**

`npm run dev` → open a real `.docx` via test input once wiring exists (Task 6). If implementing DocxReader before wiring, unit-test conversion path is enough for this task.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/DocxReader.svelte src/lib/lazy-docx-reader.ts
git commit -m "feat: add DocxReader with text excerpts"
```

---

### Task 6: Wire page, Settings, palette, drop handler

**Files:**

- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/SettingsPanel.svelte`

- [ ] **Step 1: Settings panel prop + button**

In `SettingsPanel.svelte`:

- Add prop `onOpenDocx?: () => void`
- In Data actions, after markdown import (or near other imports):

```svelte
{#if onOpenDocx}
	<button
		type="button"
		class="mash-settings-action"
		data-testid="settings-open-docx"
		onclick={onOpenDocx}
	>
		Open Word document…
	</button>
{/if}
```

Wire from `+page.svelte` where SettingsPanel is rendered: `onOpenDocx={() => { settingsOpen = false; docxInputEl?.click(); }}`

- [ ] **Step 2: Page state + open/save/hide (mirror PDF)**

Near PDF state (~lines 186–193), add:

```ts
let docxReaderFile: File | null = $state(null);
let docxReaderOpen = $state(false);
let LazyDocxReader = $state<(typeof import('$lib/components/DocxReader.svelte'))['default'] | null>(
	null
);
let docxReaderModuleLoading = $state(false);
let docxClippings = $state<import('$lib/docx-clipping').DocxClipping[]>([]);
let docxInputEl: HTMLInputElement | undefined = $state();
```

Import helpers:

```ts
import { docxClippingTitle, normalizeDocxExcerpt } from '$lib/docx-clipping';
```

Functions (mirror PDF block ~848–960):

```ts
async function ensureDocxReaderModule() {
	if (LazyDocxReader || docxReaderModuleLoading) return;
	docxReaderModuleLoading = true;
	try {
		const { loadDocxReader } = await import('$lib/lazy-docx-reader');
		LazyDocxReader = await loadDocxReader();
	} catch (e) {
		console.error(e);
		docxReaderOpen = false;
		flashToast('Couldn’t load Word document tools', 3600);
	} finally {
		docxReaderModuleLoading = false;
	}
}

function openDocxReader(file: File) {
	docxReaderFile = file;
	docxReaderOpen = true;
	docxClippings = [];
	// If PDF is open, hide it so only one overlay shows
	pdfReaderOpen = false;
	void ensureDocxReaderModule();
}

function resumeDocxReader() {
	if (!docxReaderFile) return;
	docxReaderOpen = true;
	pdfReaderOpen = false;
	void ensureDocxReaderModule();
}

function hideDocxReader() {
	docxReaderOpen = false;
}

async function saveDocxClipping(excerpt: { text: string }) {
	if (!docxReaderFile) return;
	const text = normalizeDocxExcerpt(excerpt.text ?? '');
	if (!text) return;
	const note = await createNote({
		title: docxClippingTitle(text),
		body: text,
		folder: '',
		tags: ['docx-clipping'],
		pinned: 0,
		source: {
			kind: 'docx',
			title: docxReaderFile.name
		}
	});
	// follow same library refresh / search indexing as savePdfClipping
	// (copy the pattern from savePdfClipping for adding to library + toast)
	docxClippings = [...docxClippings, { id: crypto.randomUUID(), noteId: note.id, text }];
	flashToast('Saved excerpt from Word document');
}

async function openDocxClippingsOnCanvas(noteIds: string[]) {
	// same as openPdfClippingsOnCanvas
	await canvas.handleDropNotes(noteIds /* spawn center or same helper */);
	docxReaderOpen = false;
	flashToast(`Opened ${noteIds.length} clipping${noteIds.length === 1 ? '' : 's'} on canvas`);
}
```

**Important:** Read the real `savePdfClipping` / `openPdfClippingsOnCanvas` and replicate library integration (`library` add note, etc.) exactly — do not invent a different note persistence path.

When opening PDF, set `docxReaderOpen = false` (symmetric exclusive overlay).

- [ ] **Step 3: Drop handler**

In `handleDroppedFiles`:

```ts
const supportedCount =
	batch.noteTextFiles.length +
	batch.jsonFiles.length +
	batch.pdfFiles.length +
	batch.docxFiles.length;
if (supportedCount === 0) {
	flashToast('Drop a PDF, Word (.docx), text note, or Mash JSON file', 3000);
	return;
}
```

Document open rule (after notes/json processing, same as today for PDF):

```ts
let openedDocName = '';
if (batch.pdfFiles.length > 0) {
	openPdfReader(batch.pdfFiles[0]!);
	openedDocName = batch.pdfFiles[0]!.name;
	if (batch.pdfFiles.length > 1) failedCount += batch.pdfFiles.length - 1;
	// extra docx in same drop are skipped for overlay
	if (batch.docxFiles.length > 0) failedCount += batch.docxFiles.length;
} else if (batch.docxFiles.length > 0) {
	openDocxReader(batch.docxFiles[0]!);
	openedDocName = batch.docxFiles[0]!.name;
	if (batch.docxFiles.length > 1) failedCount += batch.docxFiles.length - 1;
}
```

Toast parts: if opened doc name, `Opened ${openedDocName}` (reuse PDF toast style).

- [ ] **Step 4: Palette + hidden input + reader mount**

Palette action next to PDF:

```ts
{
	label: 'Open Word document…',
	action: () => {
		showPalette = false;
		docxInputEl?.click();
	},
	shortcut: ''
},
```

Hidden input next to PDF input:

```svelte
<input
	bind:this={docxInputEl}
	data-testid="docx-reader-input"
	type="file"
	accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	class="hidden"
	onchange={(e) => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) openDocxReader(file);
	}}
/>
```

Mount reader near PDF mount:

```svelte
{#if docxReaderFile && LazyDocxReader}
	{#key docxReaderFile}
		<LazyDocxReader
			file={docxReaderFile}
			clippings={docxClippings}
			open={docxReaderOpen}
			onClose={hideDocxReader}
			onClip={saveDocxClipping}
			onOpenClippings={openDocxClippingsOnCanvas}
		/>
	{/key}
{:else if docxReaderOpen && docxReaderModuleLoading}
	<section class="mash-pdf-reader" aria-label="Word document reader">
		<div
			class="flex h-full items-center justify-center text-sm"
			style="color: var(--mash-ink-muted);"
		>
			Loading Word document tools…
		</div>
	</section>
{/if}
```

Return chip: mirror `.mash-reader-return` for PDF; either generalize to show active session for PDF **or** docx, or add a second chip when `docxReaderFile && !docxReaderOpen`. Prefer one control that resumes whichever document session exists (if both somehow set, PDF takes precedence).

- [ ] **Step 5: Typecheck**

```bash
npm run check
```

Fix any `NoteSource` exhaustiveness in `board-image-export.ts` / sync conflict merge if they assume only `pdf`:

```ts
// board-image-export.ts — extend subtitle helper:
note.source?.kind === 'pdf'
	? `${note.source.title} · p. ${note.source.page}`
	: note.source?.kind === 'docx'
		? note.source.title
		: undefined;
```

Check `note-library.svelte.ts` PDF source merge (~749) and extend for docx if it special-cases source kind.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/SettingsPanel.svelte src/lib/board-image-export.ts src/lib/stores/note-library.svelte.ts
git commit -m "feat: wire docx reader into drop, settings, and palette"
```

---

### Task 7: E2E + README

**Files:**

- Create: `e2e/docx-reader.spec.ts`
- Modify: `README.md`
- Optionally extend: `e2e/file-drop.spec.ts` for toast copy

- [ ] **Step 1: E2E open + clip**

Create `e2e/docx-reader.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { wipeIndexedDb } from './helpers';

async function minimalDocxBuffer(paragraphText: string): Promise<Buffer> {
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	);
	zip.folder('_rels')?.file(
		'.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
	);
	const escaped = paragraphText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	zip.folder('word')?.file(
		'document.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`
	);
	return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

test('opens a Word document and saves a text excerpt', async ({ page }) => {
	await wipeIndexedDb(page);

	await page.getByTestId('docx-reader-input').setInputFiles({
		name: 'reader-session.docx',
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		buffer: await minimalDocxBuffer('Docx excerpt for Mash')
	});

	const reader = page.getByRole('region', { name: 'Word document reader' });
	await expect(reader).toBeVisible();
	await expect(reader.getByText('Docx excerpt for Mash')).toBeVisible();

	const stage = page.getByTestId('docx-reader-stage');
	await stage.evaluate((el) => {
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(el);
		selection?.removeAllRanges();
		selection?.addRange(range);
		el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	});

	await reader.getByRole('button', { name: 'Save excerpt' }).click();
	await expect(reader.getByText(/1 saved from this document/i)).toBeVisible();

	await reader.getByRole('button', { name: /Open 1 on canvas/i }).click();
	await expect(page.getByRole('group', { name: 'Docx excerpt for Mash' })).toBeVisible();
});
```

Ensure Playwright can resolve `jszip` (devDependency from Task 2).

- [ ] **Step 2: Update drop toast e2e if it asserts old copy**

Grep `Drop a PDF` in e2e; update string if asserted.

- [ ] **Step 3: README**

Under “What’s in the app”, add a bullet:

```markdown
- Drop or open **Word (.docx)** documents in a read-only reader and clip text to stickies (PDF reader remains for PDFs)
```

- [ ] **Step 4: Full verification**

```bash
npm run check
npm run test:unit -- --run
npx playwright test e2e/docx-reader.spec.ts e2e/pdf-reader.spec.ts e2e/file-drop.spec.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add e2e/docx-reader.spec.ts README.md e2e/file-drop.spec.ts
git commit -m "test: e2e coverage for docx reader and clips"
```

---

## Self-review (plan vs spec)

| Spec requirement                    | Task         |
| ----------------------------------- | ------------ |
| Classify `.docx` + MIME             | Task 1       |
| Pages unsupported                   | Task 1 tests |
| mammoth convert, 8MB, no images     | Task 2       |
| NoteSource docx + import validation | Task 3       |
| Shared DocumentReaderShell          | Task 4       |
| DocxReader view + text clip         | Task 5       |
| Drop / palette / Settings           | Task 6       |
| Mixed drop PDF-before-docx          | Task 6       |
| Toast copy update                   | Task 6       |
| E2E + README                        | Task 7       |
| PDF regression                      | Tasks 4, 7   |

No Pages implementation (deferred). No region crop for docx. No DOMPurify.

---

## Execution notes

- Prefer **subagent-driven-development** with one task per agent and PDF e2e as the regression gate after Task 4.
- Worktree optional; main branch is fine if clean.
- If shell extraction in Task 4 balloons, ship a minimal shell that wraps both without renaming every CSS class — visual parity beats perfect class naming.
