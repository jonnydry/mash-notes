/**
 * Mash — Combine & export helpers
 *
 * Pure transforms over notes. No DB/UI imports.
 * "Mash" here is an action: pull notes together and move them out.
 */

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
export function downloadTextFile(
	content: string,
	filename: string,
	mimeType: string
): void {
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
