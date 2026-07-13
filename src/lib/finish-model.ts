import type { CanvasItem, Note, Operation } from './types';

export type FinishScope = 'selected' | 'results' | 'desk';
export type FinishExportKind =
	'copy-markdown' | 'download-markdown' | 'pdf' | 'board-image' | 'bundle';
export type FinishDisposition = 'leave' | 'keep-desk' | 'clear';

export type FinishDraft = {
	scope: FinishScope;
	keepTakeaway: boolean;
	disposition: FinishDisposition;
};

export type FinishSnapshot = {
	sessionId: string;
	canvasId: string | null;
	selectedNoteIds: string[];
	resultNoteIds: string[];
	deskNoteIds: string[];
	openedAt: number;
};

export type FinishScopeOption = {
	scope: FinishScope;
	label: string;
	noteIds: string[];
	count: number;
	enabled: boolean;
	preview: string;
};

type FinishSnapshotInput = {
	sessionId: string;
	canvasId: string | null;
	notes: Note[];
	canvasItems: CanvasItem[];
	selectedNoteIds: Iterable<string>;
	operations: Operation[];
	openedAt?: number;
};

function uniqueValidIds(ids: Iterable<string>, validIds: Set<string>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of ids) {
		if (!validIds.has(id) || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
}

/** Stable top-to-bottom, then left-to-right order for cards on the current canvas. */
export function spatialNoteIds(items: CanvasItem[]): string[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.index - b.index)
		.map(({ item }) => item.noteId);
}

export function createFinishSnapshot(input: FinishSnapshotInput): FinishSnapshot {
	const sessionNotes = input.notes.filter(
		(note) => note.deletedAt == null && (!note.sessionId || note.sessionId === input.sessionId)
	);
	const validIds = new Set(sessionNotes.map((note) => note.id));
	const selectedNoteIds = uniqueValidIds(input.selectedNoteIds, validIds);

	const resultNoteIds = uniqueValidIds(
		[...input.operations]
			.filter(
				(operation) => operation.sessionId === input.sessionId && operation.revertedAt == null
			)
			.sort((a, b) => b.created - a.created)
			.flatMap((operation) => operation.outputNoteIds),
		validIds
	);

	const onCanvas = uniqueValidIds(spatialNoteIds(input.canvasItems), validIds);
	const placed = new Set(onCanvas);
	const remaining = sessionNotes
		.filter((note) => !placed.has(note.id))
		.sort((a, b) => a.created - b.created || a.title.localeCompare(b.title))
		.map((note) => note.id);

	return {
		sessionId: input.sessionId,
		canvasId: input.canvasId,
		selectedNoteIds,
		resultNoteIds,
		deskNoteIds: [...onCanvas, ...remaining],
		openedAt: input.openedAt ?? Date.now()
	};
}

export function defaultFinishScope(snapshot: FinishSnapshot): FinishScope {
	if (snapshot.selectedNoteIds.length > 0) return 'selected';
	if (snapshot.resultNoteIds.length > 0) return 'results';
	return 'desk';
}

export function noteIdsForFinishScope(snapshot: FinishSnapshot, scope: FinishScope): string[] {
	if (scope === 'selected') return snapshot.selectedNoteIds;
	if (scope === 'results') return snapshot.resultNoteIds;
	return snapshot.deskNoteIds;
}

export function notesForFinishScope(
	snapshot: FinishSnapshot,
	scope: FinishScope,
	notesById: ReadonlyMap<string, Note>
): Note[] {
	return noteIdsForFinishScope(snapshot, scope)
		.map((id) => notesById.get(id))
		.filter((note): note is Note => Boolean(note && note.deletedAt == null));
}

export function finishScopeOptions(
	snapshot: FinishSnapshot,
	notesById: ReadonlyMap<string, Note>
): FinishScopeOption[] {
	return (['selected', 'results', 'desk'] as const).map((scope) => {
		const noteIds = noteIdsForFinishScope(snapshot, scope);
		const titles = noteIds.map((id) => notesById.get(id)?.title.trim() || 'Untitled').slice(0, 3);
		return {
			scope,
			label: scope === 'selected' ? 'Selected' : scope === 'results' ? 'Results' : 'Whole desk',
			noteIds,
			count: noteIds.length,
			enabled: scope === 'desk' || noteIds.length > 0,
			preview: titles.join(', ') + (noteIds.length > titles.length ? '…' : '')
		};
	});
}
