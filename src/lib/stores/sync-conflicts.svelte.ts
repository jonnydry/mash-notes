/**
 * Session-only queue of sync field conflicts for the Conflicts peel.
 * Cleared on reload; not persisted to IndexedDB.
 */
import type { SyncConflict } from '$lib/sync-model';

export type PendingSyncConflict = SyncConflict & {
	id: string;
};

function conflictId(c: SyncConflict): string {
	return `${c.noteId}:${c.field}`;
}

function createSyncConflictsSession() {
	let items = $state<PendingSyncConflict[]>([]);

	const count = $derived(items.length);
	const bodyCount = $derived(items.filter((c) => c.field === 'body').length);

	function setFromImport(conflicts: SyncConflict[]) {
		items = conflicts.map((c) => ({
			...c,
			id: conflictId(c)
		}));
	}

	function dismiss(id: string) {
		items = items.filter((c) => c.id !== id);
	}

	function dismissNote(noteId: string) {
		items = items.filter((c) => c.noteId !== noteId);
	}

	function clear() {
		items = [];
	}

	function get(id: string): PendingSyncConflict | undefined {
		return items.find((c) => c.id === id);
	}

	return {
		get items() {
			return items;
		},
		get count() {
			return count;
		},
		get bodyCount() {
			return bodyCount;
		},
		setFromImport,
		dismiss,
		dismissNote,
		clear,
		get
	};
}

/** App-wide session singleton. */
export const syncConflicts = createSyncConflictsSession();
