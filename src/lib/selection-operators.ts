/**
 * Selection set operators — layout arrange + sequence/dedupe/keep wiring.
 * Keeps +page free of the operator method cluster.
 */
import type { CanvasItem, Note } from './types';
import {
	shuffledSetMoves,
	sortedSetMoves,
	spreadSetMoves,
	stackedSetMoves
} from './set-operators';
import { formatLayoutOperatorToast } from './operator-kitchen';
import { keepableNoteIds, keepSelectionToast } from './keep-selection';

export type SelectionOperatorsDeps = {
	getSelectionIds: () => string[];
	setSelection: (ids: string[], primary: string | null) => void;
	getCanvasItems: () => CanvasItem[];
	getNotesById: () => Map<string, Note>;
	handleCanvasMoveEnd: (
		moves: Array<{ itemId: string; x: number; y: number }>,
		before?: Array<{ itemId: string; x: number; y: number }>,
		opts?: {
			recordUndo?: boolean;
			label?: string;
			actionId?: string;
			affectedNoteIds?: string[];
		}
	) => Promise<void>;
	sequenceCanvasSelection: (
		noteIds: string[]
	) => Promise<{ sequenced: number; replacedLinks: number }>;
	deduplicateCanvasSelection: (
		noteIds: string[],
		notesById: Map<string, Note>
	) => Promise<{ removed: number; keepNoteIds: string[] }>;
	closeBulkMenu: () => void;
	flashToast: (msg: string, ms?: number) => void;
	flushPendingSaveAsync: () => Promise<void>;
	getWriteError: () => string;
	/** Promote selection to kept takeaways (session manager). */
	keepTakeaway: (noteIds: string[]) => Promise<Note[]>;
	applyPromotedNotes: (notes: Note[]) => void;
	recordMeaningfulActivity: () => void;
	offerPersistentStorageOnce?: () => void | Promise<void>;
};

export function createSelectionOperators(deps: SelectionOperatorsDeps) {
	function selectedCanvasItems() {
		const selected = new Set(deps.getSelectionIds());
		return deps.getCanvasItems().filter((item) => selected.has(item.noteId));
	}

	async function applyLayoutOperator(
		actionId: string,
		label: string,
		moves: Array<{ itemId: string; x: number; y: number }>
	) {
		const byId = new Map(deps.getCanvasItems().map((item) => [item.id, item]));
		const before = moves
			.map((move) => byId.get(move.itemId))
			.filter((item): item is NonNullable<typeof item> => Boolean(item))
			.map((item) => ({ itemId: item.id, x: item.x, y: item.y }));
		await deps.handleCanvasMoveEnd(moves, before, {
			label,
			actionId,
			affectedNoteIds: deps.getSelectionIds()
		});
		deps.closeBulkMenu();
		deps.flashToast(formatLayoutOperatorToast(label));
	}

	async function sortSelection(mode: 'title' | 'created') {
		const label = mode === 'title' ? 'Sort by title' : 'Sort by creation time';
		await applyLayoutOperator(
			`sort-selection-${mode}`,
			label,
			sortedSetMoves(selectedCanvasItems(), deps.getNotesById(), mode)
		);
	}

	async function shuffleSelection() {
		await applyLayoutOperator(
			'shuffle-selection',
			'Shuffle',
			shuffledSetMoves(selectedCanvasItems())
		);
	}

	async function stackSelection() {
		await applyLayoutOperator('stack-selection', 'Stack', stackedSetMoves(selectedCanvasItems()));
	}

	async function spreadSelection() {
		await applyLayoutOperator('spread-selection', 'Spread', spreadSetMoves(selectedCanvasItems()));
	}

	async function sequenceSelection() {
		const result = await deps.sequenceCanvasSelection(deps.getSelectionIds());
		deps.closeBulkMenu();
		if (result.sequenced < 2) {
			deps.flashToast('Could not sequence these cards');
			return;
		}
		const label =
			result.replacedLinks > 0
				? `Sequenced ${result.sequenced} · replaced ${result.replacedLinks} prior link${result.replacedLinks === 1 ? '' : 's'}`
				: `Sequenced ${result.sequenced} cards`;
		deps.flashToast(formatLayoutOperatorToast(label));
	}

	async function deduplicateSelection() {
		const result = await deps.deduplicateCanvasSelection(
			deps.getSelectionIds(),
			deps.getNotesById()
		);
		deps.closeBulkMenu();
		if (result.removed === 0) {
			deps.flashToast('No duplicate cards found');
			return;
		}
		deps.setSelection(result.keepNoteIds, result.keepNoteIds[0] ?? null);
		deps.flashToast(
			`Removed ${result.removed} duplicate card${result.removed === 1 ? '' : 's'} — notes remain in the library`
		);
	}

	async function keepSelection() {
		await deps.flushPendingSaveAsync();
		if (deps.getWriteError()) {
			deps.flashToast('Mash could not update local storage. Retry after saves finish.');
			return;
		}
		const ids = keepableNoteIds(deps.getSelectionIds(), deps.getNotesById());
		if (ids.length === 0) {
			deps.flashToast(keepSelectionToast(0));
			return;
		}
		const promoted = await deps.keepTakeaway(ids);
		deps.applyPromotedNotes(promoted);
		deps.recordMeaningfulActivity();
		deps.closeBulkMenu();
		if (promoted.length > 0) await deps.offerPersistentStorageOnce?.();
		deps.flashToast(keepSelectionToast(promoted.length));
	}

	return {
		selectedCanvasItems,
		applyLayoutOperator,
		sortSelection,
		shuffleSelection,
		stackSelection,
		spreadSelection,
		sequenceSelection,
		deduplicateSelection,
		keepSelection
	};
}

export type SelectionOperators = ReturnType<typeof createSelectionOperators>;
