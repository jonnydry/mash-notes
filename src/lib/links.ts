/**
 * Wikilink graph helpers — outgoing + backlinks by title.
 */
import type { Note } from './types';
import { extractWikilinks } from './markdown';

function normTitle(s: string): string {
	return s.trim().toLowerCase();
}

/** Resolve a wikilink target string to a note (exact title, case-insensitive). */
export function findNoteByTitle(notes: Note[], title: string): Note | undefined {
	const needle = normTitle(title);
	if (!needle) return undefined;
	return notes.find((n) => normTitle(n.title) === needle);
}

/**
 * Outgoing link targets for a note.
 * Prefer body extraction so stale `links[]` caches cannot diverge from content.
 */
export function outgoingLinkTargets(note: Note): string[] {
	const fromBody = extractWikilinks(note.body);
	if (fromBody.length > 0) return fromBody;
	if (note.links?.length) return [...note.links];
	return [];
}

/** Notes this note links to (resolved). */
export function findOutgoingNotes(notes: Note[], note: Note): Note[] {
	const out: Note[] = [];
	const seen = new Set<string>();
	for (const target of outgoingLinkTargets(note)) {
		const hit = findNoteByTitle(notes, target);
		if (hit && !seen.has(hit.id)) {
			seen.add(hit.id);
			out.push(hit);
		}
	}
	return out;
}

/**
 * Notes that link to `target` (by title or id).
 * Uses note.links when present, else extracts from body.
 */
export function findBacklinks(notes: Note[], target: Note | string): Note[] {
	const title =
		typeof target === 'string'
			? normTitle(target)
			: normTitle(target.title);
	const id = typeof target === 'string' ? null : target.id;
	if (!title && !id) return [];

	const back: Note[] = [];
	for (const n of notes) {
		if (id && n.id === id) continue;
		const links = outgoingLinkTargets(n);
		const hits = links.some((l) => {
			const t = normTitle(l);
			return t === title || (id !== null && t === id);
		});
		if (hits) back.push(n);
	}
	return back;
}

export type LinkSummary = {
	outgoing: Note[];
	backlinks: Note[];
	outgoingCount: number;
	backlinkCount: number;
	/** Unresolved outgoing targets (title strings). */
	unresolved: string[];
};

export function linkSummary(notes: Note[], note: Note): LinkSummary {
	const targets = outgoingLinkTargets(note);
	const outgoing = findOutgoingNotes(notes, note);
	const resolved = new Set(outgoing.map((n) => normTitle(n.title)));
	const unresolved = targets.filter((t) => !resolved.has(normTitle(t)));
	const backlinks = findBacklinks(notes, note);
	return {
		outgoing,
		backlinks,
		outgoingCount: targets.length,
		backlinkCount: backlinks.length,
		unresolved
	};
}
