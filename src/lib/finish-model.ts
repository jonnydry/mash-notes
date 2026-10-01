import type { CanvasItem, Note, Operation } from './types';

export type FinishScope = 'selected' | 'results' | 'desk';
export type FinishExportKind =
	'copy-markdown' | 'download-markdown' | 'pdf' | 'docx' | 'board-image' | 'bundle';
export type FinishDisposition = 'leave' | 'keep-desk' | 'clear';

export type FinishDraft = {
	scope: FinishScope;
	keepTakeaway: boolean;
	disposition: FinishDisposition;
};

export type FinishSnapshot = {
	sessionId: string;
	canvasId: string | null;
	/** Cards actually placed on the canvas, in spatial order. */
	canvasNoteIds: string[];
	selectedNoteIds: string[];
	resultNoteIds: string[];
	deskNoteIds: string[];
	/** Newest non-reverted operation on this desk, if any. */
	latestOperationType: string | null;
	openedAt: number;
};

export type FinishScopeOption = {
	scope: FinishScope;
	label: string;
	/** Radio label. Names extra cards after Split by lines instead of a bare higher count. */
	choiceLabel: string;
	/** Header count. Matches `choiceLabel` when that label names extra cards. */
	countLabel: string;
	/** True when Whole desk is larger than the takeaway after Split by lines. */
	namesExtras: boolean;
	noteIds: string[];
	count: number;
	enabled: boolean;
	preview: string;
};

/** Visible Finish copy when nothing is placed on the canvas. */
export const EMPTY_CANVAS_FINISH_COPY = 'The canvas is empty.';

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
	const latestOperationType =
		[...input.operations]
			.filter(
				(operation) => operation.sessionId === input.sessionId && operation.revertedAt == null
			)
			.sort((a, b) => b.created - a.created)[0]?.type ?? null;

	// An empty canvas has no takeaway. Notes that are not placed are not cards to take.
	const canvasEmpty = onCanvas.length === 0;
	return {
		sessionId: input.sessionId,
		canvasId: input.canvasId,
		canvasNoteIds: onCanvas,
		selectedNoteIds: canvasEmpty ? [] : selectedNoteIds,
		resultNoteIds: canvasEmpty ? [] : resultNoteIds,
		deskNoteIds: canvasEmpty ? [] : [...onCanvas, ...remaining],
		latestOperationType,
		openedAt: input.openedAt ?? Date.now()
	};
}

export function finishCanvasIsEmpty(snapshot: FinishSnapshot): boolean {
	return snapshot.canvasNoteIds.length === 0;
}

function joinCardNames(names: string[]): string {
	if (names.length <= 1) return names[0] ?? '';
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function noteTitle(notesById: ReadonlyMap<string, Note>, id: string): string {
	return notesById.get(id)?.title.trim() || 'Untitled';
}

/**
 * After Split by lines, Whole desk can include cards the takeaway does not.
 * Name those cards. A bare higher count does not say what they are.
 */
function splitLinesDeskChoiceLabel(
	snapshot: FinishSnapshot,
	deskNoteIds: string[],
	notesById: ReadonlyMap<string, Note>
): string | null {
	if (snapshot.latestOperationType !== 'split-lines') return null;
	const takeawayScope = defaultFinishScope(snapshot);
	if (takeawayScope === 'desk') return null;
	const takeawayIds = noteIdsForFinishScope(snapshot, takeawayScope);
	if (deskNoteIds.length <= takeawayIds.length) return null;
	const takeaway = new Set(takeawayIds);
	const extras = deskNoteIds.filter((id) => !takeaway.has(id));
	if (extras.length === 0) return null;
	return `Whole desk includes ${joinCardNames(extras.map((id) => noteTitle(notesById, id)))}`;
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
		const titles = noteIds.map((id) => noteTitle(notesById, id)).slice(0, 3);
		const label =
			scope === 'selected' ? 'Selected' : scope === 'results' ? 'Results' : 'Whole desk';
		const named = scope === 'desk' ? splitLinesDeskChoiceLabel(snapshot, noteIds, notesById) : null;
		const choiceLabel = named ?? `${label} · ${noteIds.length}`;
		const countLabel = named
			? named
			: `${noteIds.length} ${noteIds.length === 1 ? 'card' : 'cards'}`;
		return {
			scope,
			label,
			choiceLabel,
			countLabel,
			namesExtras: named !== null,
			noteIds,
			count: noteIds.length,
			enabled: scope === 'desk' || noteIds.length > 0,
			preview: titles.join(', ') + (noteIds.length > titles.length ? '…' : '')
		};
	});
}

export function finishTakeawayAnnouncement(
	snapshot: FinishSnapshot,
	option: FinishScopeOption | undefined
): string {
	if (finishCanvasIsEmpty(snapshot)) return EMPTY_CANVAS_FINISH_COPY;
	if (!option) return 'No takeaway cards';
	if (option.namesExtras) return option.choiceLabel;
	return `${option.label} takeaway, ${option.count} ${option.count === 1 ? 'card' : 'cards'}`;
}

export function finishTakeawayPreview(
	snapshot: FinishSnapshot,
	option: FinishScopeOption | undefined
): string {
	if (finishCanvasIsEmpty(snapshot)) return EMPTY_CANVAS_FINISH_COPY;
	return option?.preview || 'Add or import something first.';
}

/** Source line for a polished export. Names Split-by-lines extras instead of a bare count. */
export function finishExportSourceLabel(
	snapshot: FinishSnapshot,
	scope: FinishScope,
	notesById: ReadonlyMap<string, Note>
): string {
	const option = finishScopeOptions(snapshot, notesById).find((row) => row.scope === scope);
	if (option?.namesExtras) return option.choiceLabel;
	const count = option?.count ?? noteIdsForFinishScope(snapshot, scope).length;
	const scopeLabel =
		scope === 'selected' ? 'Selected' : scope === 'results' ? 'Results' : 'Whole desk';
	return `${scopeLabel} · ${count} ${count === 1 ? 'card' : 'cards'}`;
}
