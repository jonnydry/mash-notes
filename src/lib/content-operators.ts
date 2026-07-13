/**
 * Mash / Unmash / Split content operators.
 */
import { createNote, createOperationRecord, db, replaceNoteSubset } from './db';
import { extractWikilinks } from './markdown';
import { combineNotes } from './mash';
import { formatContentOperatorToast } from './operator-kitchen';
import { splitNoteFragments, type ContentSplitMode, type SplitFragment } from './split-content';
import type { CanvasItem, Note } from './types';
import { shouldStayOnDeskAfterMash, tryAMashAfterMashToast } from './try-a-mash';

export type ContentOperatorsDeps = {
	flashToast: (msg: string, ms?: number) => void;
	askConfirm: (opts: {
		title: string;
		message: string;
		confirmLabel?: string;
		action: () => void | Promise<void>;
	}) => void;
	getActiveSessionId: () => string | null | undefined;
	getActiveCanvasId: () => string | null | undefined;
	getCanvasFolder: () => string;
	activeNoteOwnership: () => {
		sessionId?: string;
		scope?: 'session' | 'kept';
	};
	getCanvasItems: () => CanvasItem[];
	getNotes: () => Note[];
	getNotesById: () => Map<string, Note>;
	getSelectedNotes: () => Note[];
	getSelectionIds: () => string[];
	selectedCanvasItems: () => CanvasItem[];
	mashCanvasItems: (
		sourceIds: string[],
		mashed: Note,
		operationId: string,
		place: { x: number; y: number },
		removeItemIds?: string[]
	) => Promise<CanvasItem | null | undefined>;
	unmashCanvasItem: (
		mash: Note,
		sources: Note[]
	) => Promise<{ missing: number; itemIds: string[]; restored: number }>;
	splitCanvasItem: (sourceNoteId: string, outputs: Note[], operationId: string) => Promise<boolean>;
	adoptNotes: (notes: Note[]) => void;
	setSettlingIds: (ids: Set<string>) => void;
	getExpandedNoteId: () => string | null;
	setExpandedNoteId: (id: string | null) => void;
	dismissPaneForNote: (noteId: string) => void;
	setSelection: (ids: string[], primary: string | null) => void;
	closeBulkMenu: () => void;
	openInStage: (noteId: string, zone?: 'maximize') => void;
	ensureNoteVisible: (noteId: string) => void;
	refreshOperationHistory: () => Promise<void>;
};

export function createContentOperators(deps: ContentOperatorsDeps) {
	function splitCandidate(
		mode: ContentSplitMode
	): { note: Note; fragments: SplitFragment[] } | null {
		const items = deps.selectedCanvasItems();
		if (items.length !== 1 || deps.getSelectionIds().length !== 1) return null;
		const note = deps.getNotesById().get(items[0]!.noteId);
		if (!note) return null;
		const fragments = splitNoteFragments(note, mode);
		return fragments.length >= 2 ? { note, fragments } : null;
	}

	async function splitSelection(mode: ContentSplitMode) {
		const candidate = splitCandidate(mode);
		const sessionId = deps.getActiveSessionId();
		if (!candidate || !sessionId) {
			deps.flashToast(`This card does not contain multiple ${mode}`);
			return;
		}
		const operation = await createOperationRecord({
			sessionId,
			type: `split-${mode}`,
			inputNoteIds: [candidate.note.id],
			outputNoteIds: [],
			payload: { mode }
		});
		const outputs: Note[] = [];
		try {
			for (const fragment of candidate.fragments) {
				outputs.push(
					await createNote({
						...deps.activeNoteOwnership(),
						title: fragment.title,
						body: fragment.body,
						folder: candidate.note.folder,
						tags: [...new Set([...candidate.note.tags, 'split'])],
						links: extractWikilinks(fragment.body),
						mashedFrom: [candidate.note.id],
						operationId: operation.id,
						pinned: candidate.note.pinned
					})
				);
			}
			await db.operations.update(operation.id, {
				outputNoteIds: outputs.map((note) => note.id)
			});
			const applied = await deps.splitCanvasItem(candidate.note.id, outputs, operation.id);
			if (!applied) throw new Error('Canvas split was not applied');
			deps.adoptNotes(outputs);
			deps.closeBulkMenu();
			await deps.refreshOperationHistory();
			deps.flashToast(formatContentOperatorToast(`Split by ${mode}`, 1, outputs.length));
		} catch (error) {
			console.error('Failed to split note', error);
			await replaceNoteSubset(
				outputs.map((note) => note.id),
				[]
			);
			await db.operations.delete(operation.id);
			deps.flashToast('Could not split this card');
		}
	}

	async function mashNotesIntoBubble(
		sourceNotes: Note[],
		opts?: { x?: number; y?: number; removeItemIds?: string[] }
	): Promise<boolean> {
		if (sourceNotes.length < 2) {
			deps.flashToast('Pick at least two notes to mash');
			return false;
		}
		const sessionId = deps.getActiveSessionId();
		if (!deps.getActiveCanvasId() || !sessionId) {
			deps.flashToast('Canvas not ready');
			return false;
		}

		const body = combineNotes(sourceNotes);
		const title =
			sourceNotes.length === 2
				? `${sourceNotes[0].title} + ${sourceNotes[1].title}`.slice(0, 200)
				: `Mash of ${sourceNotes.length} notes`;

		const xs = opts?.x;
		const ys = opts?.y;
		let placeX = xs ?? 80;
		let placeY = ys ?? 80;
		if (xs === undefined || ys === undefined) {
			const onBoard = deps
				.getCanvasItems()
				.filter((i) => sourceNotes.some((n) => n.id === i.noteId));
			if (onBoard.length > 0) {
				placeX = onBoard.reduce((s, i) => s + i.x, 0) / onBoard.length;
				placeY = onBoard.reduce((s, i) => s + i.y, 0) / onBoard.length;
			}
		}

		const sourceIds = sourceNotes.map((n) => n.id);
		const mergedTags = [...new Set(['mash', ...sourceNotes.flatMap((n) => n.tags)])];
		const operation = await createOperationRecord({
			sessionId,
			type: 'mash',
			inputNoteIds: sourceIds,
			outputNoteIds: [],
			payload: { sourceCount: sourceIds.length }
		});
		let mashed: Note | null = null;
		try {
			mashed = await createNote({
				...deps.activeNoteOwnership(),
				title,
				body,
				folder: deps.getCanvasFolder(),
				tags: mergedTags,
				links: extractWikilinks(body),
				mashedFrom: sourceIds,
				operationId: operation.id
			});
			await db.operations.update(operation.id, { outputNoteIds: [mashed.id] });
			const item = await deps.mashCanvasItems(
				sourceIds,
				mashed,
				operation.id,
				{ x: placeX, y: placeY },
				opts?.removeItemIds
			);
			if (!item) throw new Error('Canvas Mash was not applied');
			deps.adoptNotes([mashed]);
			deps.setSettlingIds(new Set([item.id]));
			setTimeout(() => {
				deps.setSettlingIds(new Set());
			}, 320);
			const demoCook = shouldStayOnDeskAfterMash(sourceNotes);
			if (!demoCook) {
				deps.openInStage(mashed.id, 'maximize');
			} else {
				deps.setSelection([mashed.id], mashed.id);
				deps.ensureNoteVisible(mashed.id);
			}
			await deps.refreshOperationHistory();
			deps.flashToast(
				demoCook
					? tryAMashAfterMashToast()
					: formatContentOperatorToast('Mash', sourceIds.length, 1),
				demoCook ? 4800 : undefined
			);
			return true;
		} catch (error) {
			console.error('Failed to Mash notes', error);
			if (mashed) await replaceNoteSubset([mashed.id], []);
			await db.operations.delete(operation.id);
			deps.flashToast('Could not Mash these cards');
			return false;
		}
	}

	async function combineSelection() {
		const notes = deps.getSelectedNotes();
		if (notes.length < 2) {
			deps.flashToast('Select at least 2 notes to mash');
			return;
		}
		const preview = notes
			.slice(0, 3)
			.map((n) => n.title)
			.join(', ');
		const extra = notes.length > 3 ? ` +${notes.length - 3}` : '';
		const noteIds = notes.map((n) => n.id);
		deps.askConfirm({
			title: 'Mash these notes?',
			message: `Combine ${notes.length} notes (${preview}${extra}) into one sticky. Sources leave the desk until you Unmash.`,
			confirmLabel: 'Mash',
			action: async () => {
				const latest = noteIds
					.map((id) => deps.getNotesById().get(id))
					.filter((n): n is Note => Boolean(n));
				if (latest.length < 2) {
					deps.flashToast('Select at least 2 notes to mash');
					return;
				}
				await mashNotesIntoBubble(latest);
			}
		});
	}

	async function unmashSelection() {
		if (!deps.getActiveCanvasId()) return;
		const mashNotes = deps
			.getSelectedNotes()
			.filter((n) => n.tags.includes('mash') && n.mashedFrom && n.mashedFrom.length > 0);
		if (mashNotes.length === 0) {
			deps.flashToast('Select a mashed sticky to unmash');
			return;
		}

		const placed: string[] = [];
		let missingSources = 0;
		for (const mash of mashNotes) {
			const sourceIds = mash.mashedFrom ?? [];
			const sources = sourceIds
				.map((id) => deps.getNotes().find((n) => n.id === id))
				.filter((n): n is Note => Boolean(n));
			const result = await deps.unmashCanvasItem(mash, sources);
			missingSources += result.missing;
			placed.push(...result.itemIds);
			if (result.restored > 0) {
				if (deps.getExpandedNoteId() === mash.id) deps.setExpandedNoteId(null);
				deps.dismissPaneForNote(mash.id);
			}
		}
		deps.setSettlingIds(new Set(placed));
		setTimeout(() => {
			deps.setSettlingIds(new Set());
		}, 320);
		deps.flashToast(
			missingSources > 0
				? `Unmashed — ${missingSources} source${missingSources === 1 ? '' : 's'} missing`
				: 'Unmashed — sources restored'
		);
	}

	async function handleMashCards(sourceItemId: string, targetItemId: string) {
		const items = deps.getCanvasItems();
		const source = items.find((i) => i.id === sourceItemId);
		const target = items.find((i) => i.id === targetItemId);
		if (!source || !target) return;

		const mashNoteIds = [source.noteId, target.noteId];
		const mashNotes = mashNoteIds
			.map((id) => deps.getNotesById().get(id))
			.filter((n): n is Note => Boolean(n));
		if (mashNotes.length < 2) return;

		const mashItems = items.filter((i) => mashNoteIds.includes(i.noteId));
		const midX = mashItems.reduce((s, i) => s + i.x, 0) / Math.max(1, mashItems.length);
		const midY = mashItems.reduce((s, i) => s + i.y, 0) / Math.max(1, mashItems.length);

		await mashNotesIntoBubble(mashNotes, {
			x: midX,
			y: midY,
			removeItemIds: mashItems.map((i) => i.id)
		});
	}

	return {
		splitCandidate,
		splitSelection,
		mashNotesIntoBubble,
		combineSelection,
		unmashSelection,
		handleMashCards
	};
}

export type ContentOperators = ReturnType<typeof createContentOperators>;
