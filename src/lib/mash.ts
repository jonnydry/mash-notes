/**
 * Mash — Combine & export helpers
 *
 * Pure transforms over notes. No DB/UI imports.
 * "Mash" here is an action: pull notes together and move them out.
 */

import { renderMarkdown } from './markdown';
import type { Note } from './types';

const SECTION_SEP = '\n\n---\n\n';

/**
 * Combine notes into a single Markdown document.
 * Order is preserved as given (caller controls selection order).
 */
export function combineNotes(notes: Note[]): string {
	if (notes.length === 0) return '';

	return notes
		.map((n) => {
			const title = n.title.trim() || 'Untitled';
			const body = n.body.trimEnd();
			return body ? `# ${title}\n\n${body}` : `# ${title}`;
		})
		.join(SECTION_SEP);
}

/**
 * Serialize notes as pretty-printed JSON (full Note objects).
 */
export function notesToJson(notes: Note[]): string {
	return JSON.stringify(notes, null, 2);
}

/**
 * Safe filename stem from a title or fallback.
 */
export function slugifyFilename(name: string, fallback = 'mash-export'): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return slug || fallback;
}

/**
 * Trigger a browser file download for the given content.
 * No-op in non-browser environments (e.g. unit tests).
 */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
	if (typeof document === 'undefined') return;

	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	// Defer revoke — some browsers cancel the download if revoked synchronously.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportNotesMarkdown(notes: Note[], filename?: string): string {
	const md = combineNotes(notes);
	const name =
		filename ??
		(notes.length === 1
			? `${slugifyFilename(notes[0].title)}.md`
			: `mash-combine-${notes.length}.md`);
	downloadTextFile(md, name, 'text/markdown;charset=utf-8');
	return md;
}

export function exportNotesJson(notes: Note[], filename?: string): string {
	const json = notesToJson(notes);
	const name = filename ?? `mash-notes-${notes.length}.json`;
	downloadTextFile(json, name, 'application/json');
	return json;
}

/**
 * Copy text to the clipboard. Returns false if clipboard API is unavailable.
 */
export async function copyText(text: string): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
		return false;
	}
	await navigator.clipboard.writeText(text);
	return true;
}

/**
 * Resolve selected note ids against a note list, preserving selection order.
 */
export function notesFromSelection(notes: Note[], selectedIds: Iterable<string>): Note[] {
	const byId = new Map(notes.map((n) => [n.id, n]));
	const result: Note[] = [];
	for (const id of selectedIds) {
		const note = byId.get(id);
		if (note) result.push(note);
	}
	return result;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Plain-text body for print — avoids interactive wikilink buttons in the print doc. */
function printBodyHtml(body: string): string {
	const plain = body.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) =>
		String(label ?? target).trim()
	);
	try {
		return renderMarkdown(plain).replace(/<button\b[^>]*>(.*?)<\/button>/gi, '$1');
	} catch {
		return `<pre>${escapeHtml(body)}</pre>`;
	}
}

/** Printable HTML: one note per page (browser Print → Save as PDF). */
export function sequencePrintHtml(notes: Note[], docTitle = 'Page sequence'): string {
	const pages = notes
		.map((n, i) => {
			const title = n.title.trim() || 'Untitled';
			const body = n.body.trim() ? printBodyHtml(n.body) : '<p class="empty"> </p>';
			const align = n.textAlign === 'center' || n.textAlign === 'right' ? n.textAlign : 'left';
			const breakAfter = i < notes.length - 1 ? ' page-break-after: always;' : '';
			return `<section class="page" style="text-align: ${align};${breakAfter}">
  <p class="page-num">Page ${i + 1} of ${notes.length}</p>
  <h1>${escapeHtml(title)}</h1>
  <div class="body">${body}</div>
</section>`;
		})
		.join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)}</title>
<style>
  @page { margin: 0.75in; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
    font-size: 12pt;
    line-height: 1.45;
    color: #1a1a1a;
  }
  .page { min-height: 90vh; padding: 0; }
  .page-num {
    margin: 0 0 0.75rem;
    font-size: 9pt;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #666;
  }
  h1 {
    margin: 0 0 1rem;
    font-family: Fraunces, Georgia, serif;
    font-size: 22pt;
    font-weight: 600;
    line-height: 1.2;
  }
  .body :first-child { margin-top: 0; }
  .body :last-child { margin-bottom: 0; }
  .body p, .body ul, .body ol, .body pre, .body blockquote { margin: 0.65em 0; }
  .body ul, .body ol { padding-left: 1.25em; }
  .body pre {
    white-space: pre-wrap;
    font-size: 10pt;
    background: #f4f4f4;
    padding: 0.6em 0.75em;
    border-radius: 4px;
    text-align: left;
  }
  .body code { font-size: 0.92em; }
  .empty { margin: 0; }
  @media print {
    .page { min-height: 0; }
  }
</style>
</head>
<body>
${pages}
<script>
  window.addEventListener('load', function () {
    setTimeout(function () {
      try { window.focus(); window.print(); } catch (e) {}
    }, 100);
  });
</script>
</body>
</html>`;
}

/**
 * Open a print dialog for a page sequence (Save as PDF in the browser).
 * Opens a blob URL in a new tab (avoids iframe print crashes in Chromium/PWAs).
 * If the popup is blocked, downloads an HTML file instead.
 * No-op outside the browser.
 */
export function printSequenceAsPdf(notes: Note[], docTitle?: string): boolean {
	if (typeof window === 'undefined' || notes.length === 0) return false;
	const title =
		docTitle ??
		(notes.length === 1 ? notes[0].title.trim() || 'Untitled' : `Sequence · ${notes.length} pages`);
	let html: string;
	try {
		html = sequencePrintHtml(notes, title);
	} catch (e) {
		console.error(e);
		return false;
	}
	const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	// Do not pass noopener — it makes window.open return null in Chromium.
	const win = window.open(url, '_blank', 'width=900,height=700');
	if (!win) {
		URL.revokeObjectURL(url);
		downloadTextFile(html, `${slugifyFilename(title, 'sequence')}.html`, 'text/html;charset=utf-8');
		return true;
	}
	try {
		win.opener = null;
	} catch {
		/* ignore */
	}
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	return true;
}
