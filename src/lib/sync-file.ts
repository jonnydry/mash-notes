/**
 * File-based sync transport on top of LWW merge.
 * Export a sync bundle; import merges remote notes into local.
 */
import type { Note } from './types';
import { mergeNotesLww, hasConflicts, type MergeResult, type SyncConflict } from './sync-model';
import { normalizeImportedNote } from './import-notes';

export const SYNC_BUNDLE_VERSION = 1 as const;

export type SyncBundle = {
	version: typeof SYNC_BUNDLE_VERSION;
	exportedAt: number;
	notes: Note[];
};

export type SyncMergeSummary = {
	added: number;
	updated: number;
	unchanged: number;
	results: MergeResult[];
	conflicts: SyncConflict[];
};

export function buildSyncBundle(notes: Note[]): SyncBundle {
	return {
		version: SYNC_BUNDLE_VERSION,
		exportedAt: Date.now(),
		notes: notes.map((n) => ({ ...n }))
	};
}

export function parseSyncBundle(
	raw: string
): { ok: true; bundle: SyncBundle } | { ok: false; error: string } {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Invalid JSON' };
	}
	if (!data || typeof data !== 'object') {
		return { ok: false, error: 'Not a sync bundle' };
	}
	const obj = data as Record<string, unknown>;
	if (obj.version !== SYNC_BUNDLE_VERSION) {
		return { ok: false, error: `Unsupported sync bundle version (${String(obj.version)})` };
	}
	if (!Array.isArray(obj.notes)) {
		return { ok: false, error: 'Sync bundle missing notes array' };
	}
	if (obj.notes.length > 5000) {
		return { ok: false, error: 'Too many notes in sync bundle (max 5000)' };
	}

	const notes: Note[] = [];
	for (let i = 0; i < obj.notes.length; i++) {
		const result = normalizeImportedNote(obj.notes[i], i);
		if (typeof result === 'string') return { ok: false, error: result };
		notes.push(result);
	}

	return {
		ok: true,
		bundle: {
			version: SYNC_BUNDLE_VERSION,
			exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
			notes
		}
	};
}

/**
 * Merge remote bundle into local notes map.
 * Returns updated note list + conflict summary (LWW already chose winners).
 */
export function mergeSyncBundle(
	localNotes: Note[],
	bundle: SyncBundle
): { notes: Note[]; summary: SyncMergeSummary } {
	const byId = new Map(localNotes.map((n) => [n.id, n]));
	const results: MergeResult[] = [];
	const conflicts: SyncConflict[] = [];
	let added = 0;
	let updated = 0;
	let unchanged = 0;

	for (const remote of bundle.notes) {
		const local = byId.get(remote.id);
		if (!local) {
			byId.set(remote.id, { ...remote });
			added += 1;
			continue;
		}
		const merged = mergeNotesLww(local, remote);
		results.push(merged);
		if (hasConflicts(merged)) {
			conflicts.push(...merged.conflicts);
		}
		const changed =
			merged.note.modified !== local.modified ||
			JSON.stringify(merged.note) !== JSON.stringify(local);
		if (changed) {
			byId.set(remote.id, merged.note);
			updated += 1;
		} else {
			unchanged += 1;
		}
	}

	return {
		notes: [...byId.values()].sort((a, b) => b.modified - a.modified),
		summary: { added, updated, unchanged, results, conflicts }
	};
}

export function downloadSyncBundle(notes: Note[], filename = 'mash-sync-bundle.json') {
	const bundle = buildSyncBundle(notes);
	const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
