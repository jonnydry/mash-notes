/**
 * Validated note import from JSON exports.
 */
import type { Note } from './types';

const MAX_NOTES = 5000;
const MAX_BODY = 500_000;
const MAX_TITLE = 200;
const MAX_TAGS = 50;
const MAX_TAG_LEN = 64;

export type ImportResult = { ok: true; notes: Note[] } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Normalize/validate a single note from untrusted JSON. */
export function normalizeImportedNote(raw: unknown, index: number): Note | string {
	if (!isRecord(raw)) return `Note ${index + 1} is not an object`;
	const now = Date.now();
	const id = asString(raw.id).trim() || crypto.randomUUID();
	const title = asString(raw.title, 'Untitled').trim().slice(0, MAX_TITLE) || 'Untitled';
	const body = asString(raw.body).slice(0, MAX_BODY);
	const folder = asString(raw.folder).slice(0, 200);
	const tagsRaw = Array.isArray(raw.tags) ? raw.tags : [];
	if (tagsRaw.length > MAX_TAGS) return `Note "${title}" has too many tags`;
	const tags = tagsRaw
		.filter((t): t is string => typeof t === 'string')
		.map((t) => t.trim().slice(0, MAX_TAG_LEN))
		.filter(Boolean);
	const pinned: 0 | 1 = raw.pinned === 1 ? 1 : 0;
	const links = Array.isArray(raw.links)
		? raw.links.filter((l): l is string => typeof l === 'string').map((l) => l.slice(0, 200))
		: undefined;
	const mashedFrom = Array.isArray(raw.mashedFrom)
		? raw.mashedFrom.filter((l): l is string => typeof l === 'string')
		: undefined;
	const operationId =
		typeof raw.operationId === 'string' ? raw.operationId.trim() || undefined : undefined;
	const textAlignRaw = asString(raw.textAlign);
	const textAlign =
		textAlignRaw === 'left' || textAlignRaw === 'center' || textAlignRaw === 'right'
			? textAlignRaw
			: undefined;
	const sourceRaw = isRecord(raw.source) ? raw.source : null;
	const source =
		sourceRaw?.kind === 'pdf' &&
		typeof sourceRaw.title === 'string' &&
		typeof sourceRaw.page === 'number' &&
		Number.isFinite(sourceRaw.page)
			? {
					kind: 'pdf' as const,
					title: sourceRaw.title.trim().slice(0, 300),
					page: Math.max(1, Math.floor(sourceRaw.page))
				}
			: undefined;
	return {
		id,
		title,
		body,
		folder,
		tags,
		created: asNumber(raw.created, now),
		modified: asNumber(raw.modified, now),
		pinned,
		links,
		mashedFrom,
		operationId,
		textAlign,
		source
	};
}

/**
 * Parse and validate a Mash JSON export (array of notes).
 */
export function parseNotesJson(text: string): ImportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: 'Invalid JSON' };
	}
	if (!Array.isArray(parsed)) {
		return { ok: false, error: 'Expected a JSON array of notes' };
	}
	if (parsed.length === 0) {
		return { ok: false, error: 'No notes in file' };
	}
	if (parsed.length > MAX_NOTES) {
		return { ok: false, error: `Too many notes (max ${MAX_NOTES})` };
	}

	const notes: Note[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < parsed.length; i++) {
		const result = normalizeImportedNote(parsed[i], i);
		if (typeof result === 'string') return { ok: false, error: result };
		if (seen.has(result.id)) {
			result.id = crypto.randomUUID();
		}
		seen.add(result.id);
		notes.push(result);
	}
	return { ok: true, notes };
}
