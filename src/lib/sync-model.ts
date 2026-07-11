/**
 * Sync / conflict model (Phase 3 foundation).
 *
 * Local-first LWW (last-writer-wins) with field-level merge for notes.
 * No network transport yet — this defines how two note revisions reconcile.
 */
import type { Note } from './types';

export type SyncConflictField = keyof Pick<
	Note,
	| 'title'
	| 'body'
	| 'folder'
	| 'tags'
	| 'pinned'
	| 'links'
	| 'mashedFrom'
	| 'operationId'
	| 'textAlign'
	| 'source'
>;

export type SyncConflict = {
	noteId: string;
	field: SyncConflictField;
	local: unknown;
	remote: unknown;
	chosen: 'local' | 'remote';
};

export type MergeResult = {
	note: Note;
	conflicts: SyncConflict[];
};

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge remote into local using modified timestamps.
 * On same modified, prefer remote for body/title and union tags.
 * Records conflicts when both sides changed the same field from a shared base.
 */
export function mergeNotesLww(local: Note, remote: Note, base?: Note | null): MergeResult {
	if (local.id !== remote.id) {
		throw new Error('Cannot merge notes with different ids');
	}

	const conflicts: SyncConflict[] = [];
	const localWins = local.modified > remote.modified;
	const remoteWins = remote.modified > local.modified;
	const tie = local.modified === remote.modified;

	const fields: SyncConflictField[] = [
		'title',
		'body',
		'folder',
		'tags',
		'pinned',
		'links',
		'mashedFrom',
		'operationId',
		'textAlign',
		'source'
	];

	const merged: Note = { ...local };

	for (const field of fields) {
		const lv = local[field];
		const rv = remote[field];
		if (sameValue(lv, rv)) continue;

		const baseVal = base?.[field];
		const localChanged = base ? !sameValue(lv, baseVal) : true;
		const remoteChanged = base ? !sameValue(rv, baseVal) : true;

		if (localChanged && remoteChanged && !sameValue(lv, rv)) {
			let chosen: 'local' | 'remote';
			if (field === 'tags') {
				const union = [...new Set([...(local.tags ?? []), ...(remote.tags ?? [])])];
				merged.tags = union;
				chosen = localWins ? 'local' : 'remote';
				conflicts.push({ noteId: local.id, field, local: lv, remote: rv, chosen });
				continue;
			}
			chosen = remoteWins || tie ? 'remote' : 'local';
			(merged as unknown as Record<string, unknown>)[field] = chosen === 'remote' ? rv : lv;
			conflicts.push({ noteId: local.id, field, local: lv, remote: rv, chosen });
			continue;
		}

		if (remoteChanged && !localChanged) {
			(merged as unknown as Record<string, unknown>)[field] = rv;
		} else if (localChanged && !remoteChanged) {
			(merged as unknown as Record<string, unknown>)[field] = lv;
		} else if (remoteWins) {
			(merged as unknown as Record<string, unknown>)[field] = rv;
		}
	}

	merged.modified = Math.max(local.modified, remote.modified);
	merged.created = Math.min(local.created, remote.created);
	return { note: merged, conflicts };
}

/** True when merge produced unresolved field disagreements. */
export function hasConflicts(result: MergeResult): boolean {
	return result.conflicts.length > 0;
}
