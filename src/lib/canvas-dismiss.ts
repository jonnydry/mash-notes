/**
 * Notes intentionally removed from a folder canvas should not be auto-readded
 * when the folder membership reloads. Dropping them back clears the dismissal.
 */

const PREFIX = 'mash.canvasDismissed.';

function readSet(canvasId: string): Set<string> {
	try {
		const raw = localStorage.getItem(PREFIX + canvasId);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((id): id is string => typeof id === 'string'));
	} catch {
		return new Set();
	}
}

function writeSet(canvasId: string, ids: Set<string>): void {
	try {
		if (ids.size === 0) {
			localStorage.removeItem(PREFIX + canvasId);
			return;
		}
		localStorage.setItem(PREFIX + canvasId, JSON.stringify([...ids]));
	} catch {
		/* ignore */
	}
}

export function getDismissedNoteIds(canvasId: string): Set<string> {
	return readSet(canvasId);
}

export function dismissNoteFromCanvas(canvasId: string, noteId: string): void {
	const ids = readSet(canvasId);
	ids.add(noteId);
	writeSet(canvasId, ids);
}

export function undismissNoteFromCanvas(canvasId: string, noteId: string): void {
	const ids = readSet(canvasId);
	if (!ids.delete(noteId)) return;
	writeSet(canvasId, ids);
}

export function undismissNotesFromCanvas(canvasId: string, noteIds: string[]): void {
	if (noteIds.length === 0) return;
	const ids = readSet(canvasId);
	let changed = false;
	for (const id of noteIds) {
		if (ids.delete(id)) changed = true;
	}
	if (changed) writeSet(canvasId, ids);
}

export function clearDismissedForCanvas(canvasId: string): void {
	try {
		localStorage.removeItem(PREFIX + canvasId);
	} catch {
		/* ignore */
	}
}

export type DismissedByCanvas = Record<string, string[]>;

/** Snapshot all dismissals for sync export. */
export function exportAllDismissed(): DismissedByCanvas {
	const out: DismissedByCanvas = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith(PREFIX)) continue;
			const canvasId = key.slice(PREFIX.length);
			out[canvasId] = [...readSet(canvasId)];
		}
	} catch {
		/* ignore */
	}
	return out;
}

/**
 * Merge remote dismissals into local (union per canvas).
 * Keys must already be local canvas ids.
 */
export function importDismissedMap(map: DismissedByCanvas): void {
	for (const [canvasId, noteIds] of Object.entries(map)) {
		if (!canvasId || !Array.isArray(noteIds) || noteIds.length === 0) continue;
		const ids = readSet(canvasId);
		for (const id of noteIds) {
			if (typeof id === 'string' && id) ids.add(id);
		}
		writeSet(canvasId, ids);
	}
}
