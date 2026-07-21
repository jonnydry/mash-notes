/* eslint-disable svelte/prefer-svelte-reactivity -- Collections here are immutable snapshots or local algorithmic indexes, not mutably observed state. */
/**
 * Canvas session — card helpers + reactive board / layout / sticky store.
 */
import { untrack } from 'svelte';
import {
	addCanvasElement,
	addCanvasEdge,
	addNoteToCanvas,
	bulkUpdateCanvasItemColors,
	db,
	getCanvasItems,
	getOrCreateFolderCanvas,
	listCanvasElements,
	listCanvasEdges,
	newId,
	removeCanvasElement,
	removeCanvasEdge,
	removeCanvasItem,
	removeNotesFromCanvas,
	replaceCanvasEdges,
	replaceCanvasElements,
	replaceCanvasItemSubset,
	setOperationReverted,
	bulkUpdateCanvasItemPositions,
	updateCanvasBowls,
	updateCanvasElement,
	updateCanvasItemPosition
} from '$lib/db';
import type {
	Canvas,
	CanvasArrowElement,
	CanvasArrowEndpoint,
	CanvasBowl,
	CanvasColor,
	CanvasEdge,
	CanvasElement,
	CanvasItem,
	Note
} from '$lib/types';
import { isBlankUntitledNote, notePreview } from '$lib/format';
import {
	dismissNoteFromCanvas,
	getDismissedNoteIds,
	undismissNotesFromCanvas
} from '$lib/canvas-dismiss';
import {
	CanvasUndoStack,
	rangeBetween,
	spatialNoteOrder,
	type CanvasLayoutSnapshot
} from '$lib/canvas-undo';
import { deduplicateSet, spatialSetItems } from '$lib/set-operators';
import {
	bumpOverlappingRects,
	gridSlotPosition,
	resolveOverlapsKeepingFixed,
	type AlignMode
} from '$lib/canvas-geom';
import { isPinnedCanvasKey } from '$lib/stores/note-library.svelte';
import {
	canLinkAsNextPage,
	edgesInSequence,
	findClearFlowOrigin,
	layoutFlowSequence,
	listFlowSequences
} from '$lib/canvas-flow';
import { cleanCanvasBowls, createBowlMembership, removeItemsFromBowls } from '$lib/canvas-bowls';
import { COLLAPSED_CARD, EXPANDED_CARD } from '$lib/canvas-card-sizing';
import { cloneCanvasElement, canvasElementBindsItem } from '$lib/canvas-elements';

export { COLLAPSED_CARD, EXPANDED_CARD } from '$lib/canvas-card-sizing';
export const BUMP_GAP = 24;
export const NOTE_MIME = 'application/x-mash-notes';

function plainNoteSnapshot(note: Note): Note {
	return {
		...note,
		tags: [...note.tags],
		...(note.links ? { links: [...note.links] } : {}),
		...(note.mashedFrom ? { mashedFrom: [...note.mashedFrom] } : {}),
		...(note.source ? { source: { ...note.source } } : {})
	};
}

export type CardSize = { w: number; h: number };

export function cardDisplaySize(item: CanvasItem, expandedNoteId: string | null): CardSize {
	if (expandedNoteId && item.noteId === expandedNoteId) {
		return {
			w: item.w && item.w >= EXPANDED_CARD.w ? item.w : EXPANDED_CARD.w,
			h: item.h && item.h >= EXPANDED_CARD.h ? item.h : EXPANDED_CARD.h
		};
	}
	return {
		w: item.w ?? COLLAPSED_CARD.w,
		h: item.h ?? COLLAPSED_CARD.h
	};
}

export type BumpMove = { itemId: string; x: number; y: number };

/**
 * Compute neighbor pushes when `fixedItemId` expands to `size`.
 * Returns moves + a restore map of previous positions.
 */
export function computeExpandBumps(
	items: CanvasItem[],
	fixedItemId: string,
	size: CardSize,
	expandedNoteId: string | null
): { moves: BumpMove[]; restore: Map<string, { x: number; y: number }> } {
	const fixed = items.find((i) => i.id === fixedItemId);
	if (!fixed) return { moves: [], restore: new Map() };

	const fixedRect = {
		id: fixed.id,
		x: fixed.x,
		y: fixed.y,
		w: size.w,
		h: size.h
	};
	const others = items
		.filter((i) => i.id !== fixedItemId)
		.map((i) => {
			const s = cardDisplaySize(i, expandedNoteId);
			return { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h };
		});

	const pushed = bumpOverlappingRects(fixedRect, others, BUMP_GAP);
	const restore = new Map<string, { x: number; y: number }>();
	const moves: BumpMove[] = [];
	for (const [id, pos] of pushed) {
		const cur = items.find((i) => i.id === id);
		if (!cur) continue;
		if (cur.x === pos.x && cur.y === pos.y) continue;
		restore.set(id, { x: cur.x, y: cur.y });
		moves.push({ itemId: id, x: pos.x, y: pos.y });
	}
	return { moves, restore };
}

export type CanvasBoardApi = {
	getSpawnPoint: (
		size: { w: number; h: number },
		cascadeIndex?: number
	) => { x: number; y: number };
	ensureNoteVisible: (noteId: string) => void;
	frameNoteForEditing?: (noteId: string, maxScale?: number) => void;
	applyAlign: (mode: AlignMode) => void;
	organizeToSnap?: () => void;
	clientToWorld?: (clientX: number, clientY: number) => { x: number; y: number };
	focusBowlName?: (bowlId: string) => void;
};

export type CreateCanvasSessionOpts = {
	flashToast: (msg: string) => void;
	getNotes: () => Note[];
	getNotesById: () => Map<string, Note>;
	/** Dexie canvas.folder key ('' desk, folder path, or PINNED_CANVAS_KEY). */
	getCanvasKey: () => string;
	/** Owning lifecycle session. Canvas loading waits until this is available. */
	getSessionId?: () => string | null;
	/** Session whose note library has finished loading. Prevents startup/session-switch races. */
	getLoadedNotesSessionId?: () => string | null;
	onMeaningfulActivity?: () => void;
	onOperationChanged?: () => void | Promise<void>;
	/** Pin a note when dropped onto the Pinned canvas. */
	ensureNotePinned?: (noteId: string) => void | Promise<void>;
	getSelectionIds: () => string[];
	getSelectionSet: () => Set<string>;
	getSelectedId: () => string | null;
	setSelection: (ids: string[], selectedId: string | null) => void;
	selectNote: (id: string, opts?: { keepSelection?: boolean }) => void;
	toggleSelection: (id: string, opts?: { additive?: boolean; range?: boolean }) => void;
	deleteBlankNote: (id: string) => Promise<void>;
	removeNoteFromSearch: (id: string) => void;
	removeNoteFromLibrary: (id: string) => void;
	/** Apply generated-note membership when a content receipt is undone/redone. */
	applyNoteReceipt?: (
		notesBefore: Note[] | undefined,
		notesAfter: Note[] | undefined,
		direction: 'before' | 'after'
	) => void | Promise<void>;
	/** Close transient chrome before revealing an in-desk editor. */
	prepareCompactOpen?: () => void;
};

export function createCanvasSession(opts: CreateCanvasSessionOpts) {
	let activeCanvas = $state<Canvas | null>(null);
	let canvasItems = $state<CanvasItem[]>([]);
	let canvasEdges = $state<CanvasEdge[]>([]);
	let canvasElements = $state<CanvasElement[]>([]);
	let selectedCanvasElementId = $state<string | null>(null);
	let expandedNoteId = $state<string | null>(null);
	let expandFocus = $state<'title' | 'body' | null>(null);
	let bumpRestore: Map<string, { x: number; y: number }> | null = $state(null);
	let settlingIds = $state<Set<string>>(new Set());
	let draggingTrayId = $state<string | null>(null);
	let touchPlaceGhost = $state<{
		noteId: string;
		clientX: number;
		clientY: number;
	} | null>(null);
	let canvasUndoTick = $state(0);
	let canvasBoard: CanvasBoardApi | undefined = $state();

	// Non-reactive: must not invalidate folder-membership $effect via seq bumps.
	let canvasLoadSeq = 0;
	let undoContextKey = '';
	/** Item ids with optimistic layout not yet confirmed from IDB (drag/resize). */
	const dirtyLayoutIds = new Set<string>();
	const canvasUndo = new CanvasUndoStack();

	const canvasUndoState = $derived.by(() => ({
		revision: canvasUndoTick,
		canUndo: canvasUndo.canUndo,
		canRedo: canvasUndo.canRedo,
		operationId: canvasUndo.undoOperationId
	}));
	const canCanvasUndo = $derived(canvasUndoState.canUndo);
	const canCanvasRedo = $derived(canvasUndoState.canRedo);
	const canvasUndoOperationId = $derived(canvasUndoState.operationId);

	const membershipKey = $derived.by(() => {
		const key = opts.getCanvasKey();
		if (!key) return '';
		if (isPinnedCanvasKey(key)) {
			return opts
				.getNotes()
				.filter((n) => n.pinned === 1)
				.map((n) => n.id)
				.sort()
				.join(',');
		}
		return opts
			.getNotes()
			.filter((n) => n.folder === key || n.folder.startsWith(key + '/'))
			.map((n) => n.id)
			.sort()
			.join(',');
	});

	/** Re-run canvas load when context or membership changes. */
	$effect(() => {
		const context = {
			key: opts.getCanvasKey(),
			sessionId: opts.getSessionId?.() ?? null,
			loadedNotesSessionId: opts.getLoadedNotesSessionId?.() ?? null,
			membershipKey
		};
		if (opts.getSessionId && !context.sessionId) return;
		if (opts.getLoadedNotesSessionId && context.loadedNotesSessionId !== context.sessionId) return;
		const nextUndoContextKey = `${context.sessionId ?? ''}:${context.key}`;
		if (nextUndoContextKey !== undoContextKey) {
			undoContextKey = nextUndoContextKey;
			// untrack: canvasUndoTick++ both reads and writes — would infinite-loop the effect.
			untrack(() => {
				canvasUndo.clear();
				canvasUndoTick++;
				bumpRestore = null;
			});
		}
		void loadContextCanvas(context.key, context.sessionId);
	});

	async function loadContextCanvas(key: string, sessionId = opts.getSessionId?.() ?? null) {
		if (opts.getSessionId && !sessionId) return;
		const seq = ++canvasLoadSeq;
		try {
			const canvas = await getOrCreateFolderCanvas(key, sessionId ?? undefined);
			if (seq !== canvasLoadSeq) return;
			activeCanvas = canvas;
			let items = await getCanvasItems(canvas.id);
			if (seq !== canvasLoadSeq) return;

			// Hide placements outside the active library. Only delete them from storage
			// when the underlying note is truly gone/deleted: during a session switch,
			// the next session's notes can arrive one reactive tick after its canvas.
			const libraryIds = new Set(opts.getNotes().map((n) => n.id));
			const orphanNoteIds = [
				...new Set(items.filter((i) => !libraryIds.has(i.noteId)).map((i) => i.noteId))
			];
			if (orphanNoteIds.length > 0) {
				const orphanNotes = await db.notes.bulkGet(orphanNoteIds);
				const permanentlyGoneIds = orphanNoteIds.filter(
					(_id, index) => !orphanNotes[index] || orphanNotes[index]?.deletedAt != null
				);
				if (permanentlyGoneIds.length > 0) {
					await removeNotesFromCanvas(canvas.id, permanentlyGoneIds);
					if (seq !== canvasLoadSeq) return;
				}
				items = items.filter((i) => libraryIds.has(i.noteId));
			}

			// Mirrored canvases: add missing members, prune leavers.
			// Notes the user removed from the board stay dismissed until dropped back.
			if (key) {
				const memberNotes = isPinnedCanvasKey(key)
					? opts.getNotes().filter((n) => n.pinned === 1)
					: opts.getNotes().filter((n) => n.folder === key || n.folder.startsWith(key + '/'));
				const memberIds = new Set(memberNotes.map((n) => n.id));
				const dismissed = getDismissedNoteIds(canvas.id);
				const staleIds = items.filter((i) => !memberIds.has(i.noteId)).map((i) => i.noteId);
				if (staleIds.length > 0) {
					await removeNotesFromCanvas(canvas.id, staleIds);
					if (seq !== canvasLoadSeq) return;
					items = items.filter((i) => memberIds.has(i.noteId));
				}

				const onCanvas = new Set(items.map((i) => i.noteId));
				const missing = memberNotes.filter((n) => !onCanvas.has(n.id) && !dismissed.has(n.id));
				if (missing.length > 0) {
					await Promise.all(
						missing.map((note, i) => {
							const idx = items.length + i;
							const slot = gridSlotPosition(idx);
							return addNoteToCanvas(canvas.id, note.id, {
								x: slot.x,
								y: slot.y,
								w: COLLAPSED_CARD.w,
								h: COLLAPSED_CARD.h
							});
						})
					);
					if (seq !== canvasLoadSeq) return;
					items = await getCanvasItems(canvas.id);
				}
			}

			if (seq !== canvasLoadSeq) return;
			const cleanedBowls = cleanCanvasBowls(
				canvas.bowls ?? [],
				items.map((item) => item.id)
			);
			const bowlsChanged = JSON.stringify(cleanedBowls) !== JSON.stringify(canvas.bowls ?? []);
			activeCanvas = { ...canvas, bowls: cleanedBowls };
			if (bowlsChanged) await updateCanvasBowls(canvas.id, cleanedBowls);
			if (seq !== canvasLoadSeq) return;
			// Preserve optimistic positions only for dirty drag/resize items, not arbitrary drift.
			const localById = new Map(canvasItems.map((i) => [i.id, i]));
			canvasItems = items.map((item) => {
				const local = localById.get(item.id);
				if (!local || !dirtyLayoutIds.has(item.id)) return item;
				if (local.x !== item.x || local.y !== item.y || local.w !== item.w || local.h !== item.h) {
					return { ...item, x: local.x, y: local.y, w: local.w, h: local.h };
				}
				return item;
			});
			const edges = await listCanvasEdges(canvas.id);
			if (seq !== canvasLoadSeq) return;
			canvasEdges = edges;
			const elements = await listCanvasElements(canvas.id);
			if (seq !== canvasLoadSeq) return;
			canvasElements = elements;
			if (
				selectedCanvasElementId &&
				!elements.some((element) => element.id === selectedCanvasElementId)
			) {
				selectedCanvasElementId = null;
			}
			if (expandedNoteId && !items.some((i) => i.noteId === expandedNoteId)) {
				expandedNoteId = null;
				expandFocus = null;
				bumpRestore = null;
			}
		} catch (e) {
			if (seq !== canvasLoadSeq) return;
			console.error('Failed to load canvas', e);
			activeCanvas = null;
			canvasItems = [];
			canvasEdges = [];
			canvasElements = [];
			selectedCanvasElementId = null;
		}
	}

	async function refreshCanvasItems() {
		if (!activeCanvas) return;
		const seq = canvasLoadSeq;
		const canvasId = activeCanvas.id;
		const items = await getCanvasItems(canvasId);
		if (seq !== canvasLoadSeq || activeCanvas?.id !== canvasId) return;
		const edges = await listCanvasEdges(canvasId);
		if (seq !== canvasLoadSeq || activeCanvas?.id !== canvasId) return;
		const elements = await listCanvasElements(canvasId);
		if (seq !== canvasLoadSeq || activeCanvas?.id !== canvasId) return;
		canvasItems = items;
		canvasEdges = edges;
		canvasElements = elements;
	}

	async function snapSequenceForLink(fromItemId: string, toItemId: string) {
		const { sequences } = listFlowSequences(canvasItems, canvasEdges);
		const seq = sequences.find(
			(s) =>
				!s.invalid &&
				s.pages.some((p) => p.id === fromItemId) &&
				s.pages.some((p) => p.id === toItemId)
		);
		if (!seq || seq.pages.length < 2) return [] as string[];
		return applyFlowLayout(seq.pages, { recordUndo: false });
	}

	/**
	 * Pack a sequence L→R into a clear band (so unrelated notes don’t sit
	 * in the arrow corridor), then push any remaining overlaps clear.
	 * Returns item ids that actually moved.
	 */
	async function applyFlowLayout(
		pages: CanvasItem[],
		layoutOpts?: { recordUndo?: boolean }
	): Promise<string[]> {
		if (pages.length === 0) return [];
		const pageIds = new Set(pages.map((p) => p.id));
		const sizedPages = pages.map((p) => {
			const s = cardDisplaySize(p, expandedNoteId);
			return { ...p, w: s.w, h: s.h };
		});
		const obstacles = canvasItems
			.filter((i) => !pageIds.has(i.id))
			.map((i) => {
				const s = cardDisplaySize(i, expandedNoteId);
				return { x: i.x, y: i.y, w: s.w, h: s.h };
			});
		const origin = findClearFlowOrigin(sizedPages, obstacles, {
			prefer: { x: sizedPages[0]!.x, y: sizedPages[0]!.y }
		});
		const laid = layoutFlowSequence(sizedPages, { origin });
		const rects = canvasItems.map((i) => {
			const s = cardDisplaySize(i, expandedNoteId);
			const pos = laid.get(i.id);
			return { id: i.id, x: pos?.x ?? i.x, y: pos?.y ?? i.y, w: s.w, h: s.h };
		});
		const bumped = resolveOverlapsKeepingFixed(rects, pageIds, BUMP_GAP);
		const before: Array<{ itemId: string; x: number; y: number }> = [];
		const moves: Array<{ itemId: string; x: number; y: number }> = [];
		for (const item of canvasItems) {
			const next = bumped.get(item.id) ?? laid.get(item.id);
			if (!next) continue;
			if (next.x === item.x && next.y === item.y) continue;
			before.push({ itemId: item.id, x: item.x, y: item.y });
			moves.push({ itemId: item.id, x: next.x, y: next.y });
		}
		if (moves.length === 0) return [];
		await handleCanvasMoveEnd(moves, before, {
			recordUndo: layoutOpts?.recordUndo !== false
		});
		return moves.map((m) => m.itemId);
	}

	/** Re-pack every valid sequence in one undoable arrange. Returns true if cards moved. */
	async function relayoutFlowSequences(): Promise<boolean> {
		const { sequences } = listFlowSequences(canvasItems, canvasEdges);
		const valid = sequences.filter((s) => !s.invalid && s.pages.length >= 2);
		if (valid.length === 0) return false;

		const working = new Map(
			canvasItems.map((i) => {
				const s = cardDisplaySize(i, expandedNoteId);
				return [i.id, { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h }];
			})
		);

		for (const seq of valid) {
			const pageIds = new Set(seq.pages.map((p) => p.id));
			const pages = seq.pages.map((p) => {
				const cur = working.get(p.id)!;
				return { ...p, x: cur.x, y: cur.y, w: cur.w, h: cur.h };
			});
			const obstacles = [...working.values()]
				.filter((r) => !pageIds.has(r.id))
				.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
			const origin = findClearFlowOrigin(pages, obstacles, {
				prefer: { x: pages[0]!.x, y: pages[0]!.y }
			});
			const laid = layoutFlowSequence(pages, { origin });
			for (const [id, pos] of laid) {
				const cur = working.get(id);
				if (!cur) continue;
				cur.x = pos.x;
				cur.y = pos.y;
			}
			const bumped = resolveOverlapsKeepingFixed([...working.values()], pageIds, BUMP_GAP);
			for (const [id, pos] of bumped) {
				const cur = working.get(id);
				if (!cur) continue;
				cur.x = pos.x;
				cur.y = pos.y;
			}
		}

		const before: Array<{ itemId: string; x: number; y: number }> = [];
		const moves: Array<{ itemId: string; x: number; y: number }> = [];
		for (const item of canvasItems) {
			const next = working.get(item.id);
			if (!next) continue;
			if (next.x === item.x && next.y === item.y) continue;
			before.push({ itemId: item.id, x: item.x, y: item.y });
			moves.push({ itemId: item.id, x: next.x, y: next.y });
		}
		if (moves.length === 0) return false;
		await handleCanvasMoveEnd(moves, before);
		return true;
	}

	async function connectFlowEdge(fromItemId: string, toItemId: string): Promise<boolean> {
		if (!activeCanvas) return false;
		const check = canLinkAsNextPage(canvasEdges, fromItemId, toItemId);
		if (!check.ok) {
			switch (check.reason) {
				case 'self':
					opts.flashToast('Pick two different cards');
					break;
				case 'cycle':
					opts.flashToast('That link would loop');
					break;
				case 'out':
					opts.flashToast('Start from the last page (it already has a next)');
					break;
				case 'in':
					opts.flashToast('That card is already in a sequence');
					break;
				default: {
					const _exhaustive: never = check.reason;
					void _exhaustive;
					opts.flashToast('Could not link cards');
				}
			}
			return false;
		}
		const edgesBefore = canvasEdges.map((e) => ({ ...e }));
		const layoutBeforeAll = snapshotItems(canvasItems.map((i) => i.id));
		try {
			const edge = await addCanvasEdge(activeCanvas.id, fromItemId, toItemId);
			if (!canvasEdges.some((e) => e.id === edge.id)) {
				canvasEdges = [...canvasEdges, edge];
			}
			const movedIds = await snapSequenceForLink(fromItemId, toItemId);
			// Only snapshot cards that actually moved — full-board snapshots make
			// prune wipe Link history when an unrelated card is dismissed.
			const layoutBefore = layoutBeforeAll.filter((s) => movedIds.includes(s.itemId));
			const layoutAfter = snapshotItems(movedIds);
			pushCanvasUndo(
				'Link',
				layoutBefore,
				layoutAfter,
				edgesBefore,
				canvasEdges.map((e) => ({ ...e }))
			);
			return true;
		} catch (e) {
			console.error(e);
			opts.flashToast('Could not link cards');
			return false;
		}
	}

	async function disconnectFlowEdge(edgeId: string) {
		const edgesBefore = canvasEdges.map((e) => ({ ...e }));
		await removeCanvasEdge(edgeId);
		canvasEdges = canvasEdges.filter((e) => e.id !== edgeId);
		pushCanvasUndo(
			'Unlink',
			[],
			[],
			edgesBefore,
			canvasEdges.map((e) => ({ ...e }))
		);
	}

	/** Remove every link in a sequence so cards become free again. */
	async function unstitchSequence(seqIndex: number): Promise<number> {
		const { sequences } = listFlowSequences(canvasItems, canvasEdges);
		const seq = sequences[seqIndex];
		if (!seq || seq.pages.length === 0) return 0;
		const toRemove = edgesInSequence(seq.pages, canvasEdges);
		if (toRemove.length === 0) return 0;
		const edgesBefore = canvasEdges.map((e) => ({ ...e }));
		const ids = new Set(toRemove.map((e) => e.id));
		await Promise.all(toRemove.map((e) => removeCanvasEdge(e.id)));
		canvasEdges = canvasEdges.filter((e) => !ids.has(e.id));
		pushCanvasUndo(
			'Unstitch',
			[],
			[],
			edgesBefore,
			canvasEdges.map((e) => ({ ...e }))
		);
		opts.flashToast(
			toRemove.length === 1 ? 'Page order removed' : `Page order removed · ${toRemove.length} links`
		);
		return toRemove.length;
	}

	async function handleDropNotes(noteIds: string[], x: number, y: number) {
		if (!activeCanvas || noteIds.length === 0) return;
		// Supersede in-flight membership reloads so they cannot wipe this drop.
		canvasLoadSeq++;
		undismissNotesFromCanvas(activeCanvas.id, noteIds);
		if (isPinnedCanvasKey(opts.getCanvasKey()) && opts.ensureNotePinned) {
			for (const id of noteIds) {
				await opts.ensureNotePinned(id);
			}
		}
		const placed: string[] = [];
		for (let i = 0; i < noteIds.length; i++) {
			const dropX = x + i * 24;
			const dropY = y + i * 24;
			const existing = canvasItems.find((item) => item.noteId === noteIds[i]);
			if (existing) {
				canvasItems = canvasItems.map((item) =>
					item.id === existing.id ? { ...item, x: dropX, y: dropY } : item
				);
				await updateCanvasItemPosition(existing.id, { x: dropX, y: dropY });
				placed.push(existing.id);
				continue;
			}
			const item = await addNoteToCanvas(activeCanvas.id, noteIds[i], {
				x: dropX,
				y: dropY,
				w: COLLAPSED_CARD.w,
				h: COLLAPSED_CARD.h
			});
			placed.push(item.id);
		}
		await refreshCanvasItems();
		opts.setSelection([...noteIds], noteIds[0] ?? null);
		settlingIds = new Set(placed);
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		opts.flashToast(
			isPinnedCanvasKey(opts.getCanvasKey())
				? `Pinned ${noteIds.length} to board`
				: `Dropped ${noteIds.length} on canvas`
		);
	}

	function snapshotItems(itemIds: string[]): CanvasLayoutSnapshot[] {
		const out: CanvasLayoutSnapshot[] = [];
		for (const id of itemIds) {
			const item = canvasItems.find((i) => i.id === id);
			if (!item) continue;
			out.push({ itemId: id, x: item.x, y: item.y, w: item.w, h: item.h });
		}
		return out;
	}

	async function applyLayoutSnapshots(snaps: CanvasLayoutSnapshot[]) {
		const patches = new Map<string, { x: number; y: number; w?: number; h?: number }>();
		for (const s of snaps) {
			patches.set(s.itemId, { x: s.x, y: s.y, w: s.w, h: s.h });
		}
		patchCanvasItems(patches);
		await bulkUpdateCanvasItemPositions(
			snaps.map((s) => ({ itemId: s.itemId, x: s.x, y: s.y, w: s.w, h: s.h }))
		);
	}

	async function applyEdgeSnapshots(edges: CanvasEdge[]) {
		if (!activeCanvas) {
			canvasEdges = edges;
			return;
		}
		canvasEdges = edges;
		await replaceCanvasEdges(activeCanvas.id, edges);
	}

	async function applyCanvasItemReceipt(
		itemsBefore: CanvasItem[] | undefined,
		itemsAfter: CanvasItem[] | undefined,
		direction: 'before' | 'after'
	) {
		if (!activeCanvas || (!itemsBefore && !itemsAfter)) return;
		// A membership-triggered reload may already be in flight. This receipt is
		// newer user intent, so prevent that older read from overwriting it.
		canvasLoadSeq++;
		const affectedIds = [
			...new Set([...(itemsBefore ?? []), ...(itemsAfter ?? [])].map((item) => item.id))
		];
		// Undo entries can originate from Svelte state. IndexedDB cannot clone
		// reactive proxies, so receipts always cross persistence as plain records.
		const desired = (direction === 'before' ? (itemsBefore ?? []) : (itemsAfter ?? [])).map(
			(item) => ({ ...item })
		);
		await replaceCanvasItemSubset(activeCanvas.id, affectedIds, desired);
		const affected = new Set(affectedIds);
		canvasItems = [...canvasItems.filter((item) => !affected.has(item.id)), ...desired];
	}

	async function applyElementSnapshots(elements: CanvasElement[] | undefined) {
		if (!activeCanvas || !elements) return;
		const desired = elements.map(cloneCanvasElement);
		await replaceCanvasElements(activeCanvas.id, desired);
		canvasElements = desired;
		if (
			selectedCanvasElementId &&
			!desired.some((element) => element.id === selectedCanvasElementId)
		) {
			selectedCanvasElementId = null;
		}
	}

	function applyDismissalReceipt(
		dismissedBefore: string[] | undefined,
		dismissedAfter: string[] | undefined,
		direction: 'before' | 'after'
	) {
		if (!activeCanvas || (!dismissedBefore && !dismissedAfter)) return;
		const affected = [...new Set([...(dismissedBefore ?? []), ...(dismissedAfter ?? [])])];
		undismissNotesFromCanvas(activeCanvas.id, affected);
		const desired = direction === 'before' ? (dismissedBefore ?? []) : (dismissedAfter ?? []);
		for (const noteId of desired) dismissNoteFromCanvas(activeCanvas.id, noteId);
	}

	function pushCanvasUndo(
		label: string,
		before: CanvasLayoutSnapshot[],
		after: CanvasLayoutSnapshot[],
		edgesBefore?: CanvasEdge[],
		edgesAfter?: CanvasEdge[]
	) {
		canvasUndo.push({ label, before, after, edgesBefore, edgesAfter });
		canvasUndoTick++;
	}

	function clearCanvasUndo() {
		canvasUndo.clear();
		canvasUndoTick++;
	}

	/** Drop undo entries that reference removed cards; keep unrelated history. */
	function pruneCanvasUndo(itemIds: Iterable<string>) {
		canvasUndo.pruneItemIds(itemIds);
		canvasUndoTick++;
	}

	async function undoCanvasLayout() {
		const entry = canvasUndo.undo();
		canvasUndoTick++;
		if (!entry) return;
		await opts.applyNoteReceipt?.(entry.notesBefore, entry.notesAfter, 'before');
		await applyCanvasItemReceipt(entry.itemsBefore, entry.itemsAfter, 'before');
		if (entry.before.length > 0) {
			await applyLayoutSnapshots(entry.before);
		}
		if (entry.edgesBefore) {
			await applyEdgeSnapshots(entry.edgesBefore);
		}
		await applyElementSnapshots(entry.elementsBefore);
		applyDismissalReceipt(entry.dismissedBefore, entry.dismissedAfter, 'before');
		if (entry.operationId) {
			await setOperationReverted(entry.operationId, entry.operationRevertedBefore ?? true);
			await opts.onOperationChanged?.();
		}
		if (entry.selectionBefore) {
			opts.setSelection(entry.selectionBefore, entry.selectionBefore[0] ?? null);
		}
		opts.flashToast(`Undo ${entry.label}`);
	}

	async function redoCanvasLayout() {
		const entry = canvasUndo.redo();
		canvasUndoTick++;
		if (!entry) return;
		await opts.applyNoteReceipt?.(entry.notesBefore, entry.notesAfter, 'after');
		await applyCanvasItemReceipt(entry.itemsBefore, entry.itemsAfter, 'after');
		if (entry.after.length > 0) {
			await applyLayoutSnapshots(entry.after);
		}
		if (entry.edgesAfter) {
			await applyEdgeSnapshots(entry.edgesAfter);
		}
		await applyElementSnapshots(entry.elementsAfter);
		applyDismissalReceipt(entry.dismissedBefore, entry.dismissedAfter, 'after');
		if (entry.operationId) {
			await setOperationReverted(entry.operationId, entry.operationRevertedAfter ?? false);
			await opts.onOperationChanged?.();
		}
		if (entry.selectionAfter) {
			opts.setSelection(entry.selectionAfter, entry.selectionAfter[0] ?? null);
		}
		opts.flashToast(`Redo ${entry.label}`);
	}

	/** Patch only touched cards — avoid remapping the full board on every drag frame. */
	function patchCanvasItems(
		patches: Map<string, { x?: number; y?: number; w?: number; h?: number }>
	) {
		if (patches.size === 0) return;
		let changed = false;
		const next = canvasItems.map((item) => {
			const p = patches.get(item.id);
			if (!p) return item;
			changed = true;
			return {
				...item,
				...(p.x !== undefined ? { x: p.x } : {}),
				...(p.y !== undefined ? { y: p.y } : {}),
				...(p.w !== undefined ? { w: p.w } : {}),
				...(p.h !== undefined ? { h: p.h } : {})
			};
		});
		if (changed) canvasItems = next;
	}

	function handleCanvasMove(itemId: string, x: number, y: number) {
		// Optimistic only — persist on drag end to avoid IndexedDB thrash.
		dirtyLayoutIds.add(itemId);
		patchCanvasItems(new Map([[itemId, { x, y }]]));
	}

	function handleCanvasMoveMany(moves: Array<{ itemId: string; x: number; y: number }>) {
		const patches = new Map<string, { x: number; y: number }>();
		for (const m of moves) {
			dirtyLayoutIds.add(m.itemId);
			patches.set(m.itemId, { x: m.x, y: m.y });
		}
		patchCanvasItems(patches);
	}

	async function handleCanvasMoveEnd(
		moves: Array<{ itemId: string; x: number; y: number }>,
		before?: Array<{ itemId: string; x: number; y: number }>,
		moveOpts?: {
			recordUndo?: boolean;
			label?: string;
			actionId?: string;
			affectedNoteIds?: string[];
		}
	) {
		// Layout operators and drag completion supersede any in-flight canvas read.
		canvasLoadSeq++;
		const beforeSnaps =
			before?.map((b) => {
				const cur = canvasItems.find((i) => i.id === b.itemId);
				return { itemId: b.itemId, x: b.x, y: b.y, w: cur?.w, h: cur?.h };
			}) ?? snapshotItems(moves.map((m) => m.itemId));
		handleCanvasMoveMany(moves);
		const afterSnaps = moves.map((m) => {
			const cur = canvasItems.find((i) => i.id === m.itemId);
			return { itemId: m.itemId, x: m.x, y: m.y, w: cur?.w, h: cur?.h };
		});
		if (moveOpts?.recordUndo !== false) {
			canvasUndo.push({
				label: moveOpts?.label ?? (moves.length > 1 ? 'Arrange' : 'Move'),
				actionId: moveOpts?.actionId,
				mutation: moveOpts?.actionId ? 'layout' : undefined,
				affectedNoteIds: moveOpts?.affectedNoteIds,
				before: beforeSnaps,
				after: afterSnaps
			});
			canvasUndoTick++;
		}
		await bulkUpdateCanvasItemPositions(moves.map((m) => ({ itemId: m.itemId, x: m.x, y: m.y })));
		for (const m of moves) dirtyLayoutIds.delete(m.itemId);
		opts.onMeaningfulActivity?.();
	}

	async function deduplicateCanvasSelection(
		noteIds: string[],
		notesById: Map<string, Note>
	): Promise<{ removed: number; keepNoteIds: string[] }> {
		if (!activeCanvas) return { removed: 0, keepNoteIds: noteIds };
		const selected = new Set(noteIds);
		const selectedItems = canvasItems.filter((item) => selected.has(item.noteId));
		const result = deduplicateSet(selectedItems, notesById);
		if (result.removeItemIds.length === 0) {
			return { removed: 0, keepNoteIds: result.keepNoteIds };
		}
		// Keep a stale membership reload from resurrecting the pre-operator view.
		canvasLoadSeq++;
		const removeIds = new Set(result.removeItemIds);
		const removedItems = canvasItems
			.filter((item) => removeIds.has(item.id))
			.map((item) => ({ ...item }));
		const edgesBefore = canvasEdges.map((edge) => ({ ...edge }));
		const edgesAfter = canvasEdges.filter(
			(edge) => !removeIds.has(edge.fromItemId) && !removeIds.has(edge.toItemId)
		);
		const elementsBefore = elementSnapshot();
		const elementsAfter = withoutCanvasElementsForItemIds(removeIds);
		await replaceCanvasItemSubset(activeCanvas.id, result.removeItemIds, []);
		await replaceCanvasEdges(activeCanvas.id, edgesAfter);
		canvasItems = canvasItems.filter((item) => !removeIds.has(item.id));
		canvasEdges = edgesAfter;
		canvasElements = elementsAfter;
		canvasUndo.push({
			label: 'Deduplicate',
			actionId: 'deduplicate-selection',
			mutation: 'content',
			affectedNoteIds: removedItems.map((item) => item.noteId),
			before: [],
			after: [],
			itemsBefore: removedItems,
			itemsAfter: [],
			edgesBefore,
			edgesAfter,
			elementsBefore,
			elementsAfter
		});
		canvasUndoTick++;
		opts.onMeaningfulActivity?.();
		return { removed: removedItems.length, keepNoteIds: result.keepNoteIds };
	}

	/**
	 * Replace links touching the selection with one spatial reading-order chain,
	 * then pack it as a storyboard row. Edges and movement share one receipt.
	 */
	async function sequenceCanvasSelection(
		noteIds: string[]
	): Promise<{ sequenced: number; replacedLinks: number }> {
		if (!activeCanvas) return { sequenced: 0, replacedLinks: 0 };
		const selected = new Set(noteIds);
		const ordered = spatialSetItems(canvasItems.filter((item) => selected.has(item.noteId)));
		if (ordered.length < 2) return { sequenced: 0, replacedLinks: 0 };

		canvasLoadSeq++;
		const selectedItemIds = new Set(ordered.map((item) => item.id));
		const edgesBefore = canvasEdges.map((edge) => ({ ...edge }));
		const retainedEdges = edgesBefore.filter(
			(edge) => !selectedItemIds.has(edge.fromItemId) && !selectedItemIds.has(edge.toItemId)
		);
		const now = Date.now();
		const chainEdges: CanvasEdge[] = ordered.slice(0, -1).map((item, index) => ({
			id: newId(),
			canvasId: activeCanvas!.id,
			fromItemId: item.id,
			toItemId: ordered[index + 1]!.id,
			created: now + index
		}));
		const edgesAfter = [...retainedEdges, ...chainEdges];
		const layoutBeforeAll = snapshotItems(canvasItems.map((item) => item.id));

		try {
			await replaceCanvasEdges(activeCanvas.id, edgesAfter);
			canvasEdges = edgesAfter;
			const movedIds = await applyFlowLayout(ordered, { recordUndo: false });
			const moved = new Set(movedIds);
			canvasUndo.push({
				label: 'Sequence',
				actionId: 'sequence-selection',
				mutation: 'layout',
				affectedNoteIds: ordered.map((item) => item.noteId),
				before: layoutBeforeAll.filter((snapshot) => moved.has(snapshot.itemId)),
				after: snapshotItems(movedIds),
				edgesBefore,
				edgesAfter: edgesAfter.map((edge) => ({ ...edge }))
			});
			canvasUndoTick++;
			opts.onMeaningfulActivity?.();
			return {
				sequenced: ordered.length,
				replacedLinks: edgesBefore.length - retainedEdges.length
			};
		} catch (error) {
			console.error('Failed to sequence selection', error);
			await replaceCanvasEdges(activeCanvas.id, edgesBefore);
			canvasEdges = edgesBefore;
			await applyLayoutSnapshots(layoutBeforeAll);
			return { sequenced: 0, replacedLinks: 0 };
		}
	}

	/** Replace one source card with generated fragment cards and one complete content receipt. */
	async function splitCanvasItem(
		sourceNoteId: string,
		outputNotes: Note[],
		operationId: string
	): Promise<boolean> {
		if (!activeCanvas || outputNotes.length < 2) return false;
		const sourceItem = canvasItems.find((item) => item.noteId === sourceNoteId);
		if (!sourceItem) return false;
		canvasLoadSeq++;
		const itemsBefore = [{ ...sourceItem }];
		const columns = Math.min(3, Math.ceil(Math.sqrt(outputNotes.length)));
		const itemsAfter: CanvasItem[] = outputNotes.map((note, index) => ({
			id: newId(),
			canvasId: activeCanvas!.id,
			noteId: note.id,
			x: sourceItem.x + (index % columns) * 244,
			y: sourceItem.y + Math.floor(index / columns) * 144,
			w: COLLAPSED_CARD.w,
			h: COLLAPSED_CARD.h
		}));
		const edgesBefore = canvasEdges.map((edge) => ({ ...edge }));
		const edgesAfter = edgesBefore.filter(
			(edge) => edge.fromItemId !== sourceItem.id && edge.toItemId !== sourceItem.id
		);
		const elementsBefore = elementSnapshot();
		const elementsAfter = withoutCanvasElementsForItemIds(new Set([sourceItem.id]));
		try {
			await replaceCanvasItemSubset(
				activeCanvas.id,
				[sourceItem.id, ...itemsAfter.map((item) => item.id)],
				itemsAfter
			);
			await replaceCanvasEdges(activeCanvas.id, edgesAfter);
			canvasItems = [...canvasItems.filter((item) => item.id !== sourceItem.id), ...itemsAfter];
			canvasEdges = edgesAfter;
			canvasElements = elementsAfter;
			dismissNoteFromCanvas(activeCanvas.id, sourceNoteId);
			const outputIds = outputNotes.map((note) => note.id);
			canvasUndo.push({
				label: 'Split',
				actionId: 'split-selection',
				operationId,
				operationRevertedBefore: true,
				operationRevertedAfter: false,
				mutation: 'content',
				affectedNoteIds: [sourceNoteId, ...outputIds],
				before: [],
				after: [],
				itemsBefore,
				itemsAfter: itemsAfter.map((item) => ({ ...item })),
				notesBefore: [],
				notesAfter: outputNotes.map(plainNoteSnapshot),
				edgesBefore,
				edgesAfter,
				elementsBefore,
				elementsAfter,
				selectionBefore: [sourceNoteId],
				selectionAfter: outputIds,
				dismissedBefore: [],
				dismissedAfter: [sourceNoteId]
			});
			canvasUndoTick++;
			await opts.onOperationChanged?.();
			opts.setSelection(outputIds, outputIds[0] ?? null);
			opts.onMeaningfulActivity?.();
			return true;
		} catch (error) {
			console.error('Failed to split canvas card', error);
			await replaceCanvasItemSubset(
				activeCanvas.id,
				[sourceItem.id, ...itemsAfter.map((item) => item.id)],
				itemsBefore
			);
			await replaceCanvasEdges(activeCanvas.id, edgesBefore);
			await replaceCanvasElements(activeCanvas.id, elementsBefore);
			canvasItems = [
				...canvasItems.filter((item) => !itemsAfter.some((next) => next.id === item.id)),
				sourceItem
			];
			canvasEdges = edgesBefore;
			canvasElements = elementsBefore;
			return false;
		}
	}

	/** Replace source cards with one Mash result and record notes, cards, links, and visibility. */
	async function mashCanvasItems(
		sourceNoteIds: string[],
		outputNote: Note,
		operationId: string,
		position: { x: number; y: number },
		restrictItemIds?: string[]
	): Promise<CanvasItem | null> {
		if (!activeCanvas) return null;
		const sourceSet = new Set(sourceNoteIds);
		const restricted = restrictItemIds ? new Set(restrictItemIds) : null;
		const itemsBefore = canvasItems
			.filter((item) => sourceSet.has(item.noteId) && (!restricted || restricted.has(item.id)))
			.map((item) => ({ ...item }));
		if (itemsBefore.length < 2) return null;
		canvasLoadSeq++;
		const outputItem: CanvasItem = {
			id: newId(),
			canvasId: activeCanvas.id,
			noteId: outputNote.id,
			x: position.x,
			y: position.y,
			w: EXPANDED_CARD.w,
			h: EXPANDED_CARD.h
		};
		const sourceItemIds = new Set(itemsBefore.map((item) => item.id));
		const edgesBefore = canvasEdges.map((edge) => ({ ...edge }));
		const edgesAfter = edgesBefore.filter(
			(edge) => !sourceItemIds.has(edge.fromItemId) && !sourceItemIds.has(edge.toItemId)
		);
		const dismissedBefore = sourceNoteIds.filter((id) =>
			getDismissedNoteIds(activeCanvas!.id).has(id)
		);
		const elementsBefore = elementSnapshot();
		const elementsAfter = withoutCanvasElementsForItemIds(sourceItemIds);
		try {
			await replaceCanvasItemSubset(
				activeCanvas.id,
				[...sourceItemIds, outputItem.id],
				[outputItem]
			);
			await replaceCanvasEdges(activeCanvas.id, edgesAfter);
			canvasItems = [...canvasItems.filter((item) => !sourceItemIds.has(item.id)), outputItem];
			canvasEdges = edgesAfter;
			canvasElements = elementsAfter;
			for (const noteId of sourceNoteIds) dismissNoteFromCanvas(activeCanvas.id, noteId);
			canvasUndo.push({
				label: 'Mash',
				actionId: 'combine-selection',
				operationId,
				operationRevertedBefore: true,
				operationRevertedAfter: false,
				mutation: 'content',
				affectedNoteIds: [...sourceNoteIds, outputNote.id],
				before: [],
				after: [],
				itemsBefore,
				itemsAfter: [{ ...outputItem }],
				notesBefore: [],
				notesAfter: [plainNoteSnapshot(outputNote)],
				edgesBefore,
				edgesAfter,
				elementsBefore,
				elementsAfter,
				selectionBefore: sourceNoteIds,
				selectionAfter: [outputNote.id],
				dismissedBefore,
				dismissedAfter: sourceNoteIds
			});
			canvasUndoTick++;
			await opts.onOperationChanged?.();
			opts.setSelection([outputNote.id], outputNote.id);
			opts.onMeaningfulActivity?.();
			return outputItem;
		} catch (error) {
			console.error('Failed to apply Mash receipt', error);
			await replaceCanvasItemSubset(
				activeCanvas.id,
				[...sourceItemIds, outputItem.id],
				itemsBefore
			);
			await replaceCanvasEdges(activeCanvas.id, edgesBefore);
			await replaceCanvasElements(activeCanvas.id, elementsBefore);
			canvasItems = [...canvasItems.filter((item) => item.id !== outputItem.id), ...itemsBefore];
			canvasEdges = edgesBefore;
			canvasElements = elementsBefore;
			applyDismissalReceipt(dismissedBefore, sourceNoteIds, 'before');
			return null;
		}
	}

	/** Explicit Unmash is itself reversible and flips the original operation receipt state. */
	async function unmashCanvasItem(
		mashNote: Note,
		sourceNotes: Note[]
	): Promise<{ restored: number; missing: number; itemIds: string[] }> {
		if (!activeCanvas || !opts.applyNoteReceipt) {
			return { restored: 0, missing: mashNote.mashedFrom?.length ?? 0, itemIds: [] };
		}
		const mashItem = canvasItems.find((item) => item.noteId === mashNote.id);
		if (!mashItem) return { restored: 0, missing: sourceNotes.length, itemIds: [] };
		canvasLoadSeq++;
		const sourceIds = mashNote.mashedFrom ?? [];
		const dismissedBefore = sourceIds.filter((id) => getDismissedNoteIds(activeCanvas!.id).has(id));
		const existingByNote = new Map(canvasItems.map((item) => [item.noteId, item]));
		const sourceItems = sourceNotes.map((note, index) => {
			const existing = existingByNote.get(note.id);
			return existing
				? { ...existing }
				: {
						id: newId(),
						canvasId: activeCanvas!.id,
						noteId: note.id,
						x: mashItem.x + index * 24,
						y: mashItem.y + index * 24,
						w: COLLAPSED_CARD.w,
						h: COLLAPSED_CARD.h
					};
		});
		const preexistingSourceItems = sourceItems.filter((item) => existingByNote.has(item.noteId));
		const itemsBefore = [{ ...mashItem }, ...preexistingSourceItems.map((item) => ({ ...item }))];
		const affectedIds = [...new Set([...itemsBefore, ...sourceItems].map((item) => item.id))];
		const edgesBefore = canvasEdges.map((edge) => ({ ...edge }));
		const edgesAfter = edgesBefore.filter(
			(edge) => edge.fromItemId !== mashItem.id && edge.toItemId !== mashItem.id
		);
		const elementsBefore = elementSnapshot();
		const elementsAfter = withoutCanvasElementsForItemIds(new Set([mashItem.id]));
		try {
			await opts.applyNoteReceipt([mashNote], [], 'after');
			await replaceCanvasItemSubset(activeCanvas.id, affectedIds, sourceItems);
			await replaceCanvasEdges(activeCanvas.id, edgesAfter);
			const affected = new Set(affectedIds);
			canvasItems = [...canvasItems.filter((item) => !affected.has(item.id)), ...sourceItems];
			canvasEdges = edgesAfter;
			canvasElements = elementsAfter;
			undismissNotesFromCanvas(activeCanvas.id, sourceIds);
			if (mashNote.operationId) await setOperationReverted(mashNote.operationId, true);
			canvasUndo.push({
				label: 'Unmash',
				actionId: 'unmash-selection',
				operationId: mashNote.operationId,
				operationRevertedBefore: false,
				operationRevertedAfter: true,
				mutation: 'content',
				affectedNoteIds: [mashNote.id, ...sourceIds],
				before: [],
				after: [],
				itemsBefore,
				itemsAfter: sourceItems.map((item) => ({ ...item })),
				notesBefore: [plainNoteSnapshot(mashNote)],
				notesAfter: [],
				edgesBefore,
				edgesAfter,
				elementsBefore,
				elementsAfter,
				selectionBefore: [mashNote.id],
				selectionAfter: sourceNotes.map((note) => note.id),
				dismissedBefore,
				dismissedAfter: []
			});
			canvasUndoTick++;
			await opts.onOperationChanged?.();
			const selection = sourceNotes.map((note) => note.id);
			opts.setSelection(selection, selection[0] ?? null);
			opts.onMeaningfulActivity?.();
			return {
				restored: sourceNotes.length,
				missing: sourceIds.length - sourceNotes.length,
				itemIds: sourceItems.map((item) => item.id)
			};
		} catch (error) {
			console.error('Failed to Unmash', error);
			await opts.applyNoteReceipt([mashNote], [], 'before');
			await replaceCanvasItemSubset(activeCanvas.id, affectedIds, itemsBefore);
			await replaceCanvasEdges(activeCanvas.id, edgesBefore);
			await replaceCanvasElements(activeCanvas.id, elementsBefore);
			const affected = new Set(affectedIds);
			canvasItems = [...canvasItems.filter((item) => !affected.has(item.id)), ...itemsBefore];
			canvasEdges = edgesBefore;
			canvasElements = elementsBefore;
			applyDismissalReceipt(dismissedBefore, [], 'before');
			return { restored: 0, missing: sourceIds.length, itemIds: [] };
		}
	}

	function handleCanvasResize(itemId: string, w: number, h: number) {
		dirtyLayoutIds.add(itemId);
		patchCanvasItems(new Map([[itemId, { w, h }]]));
	}

	async function handleCanvasResizeEnd(
		itemId: string,
		w: number,
		h: number,
		before?: { w: number; h: number }
	) {
		const item = canvasItems.find((i) => i.id === itemId);
		if (!item) return;
		// Supersede in-flight membership reloads mid-resize.
		canvasLoadSeq++;
		const beforeSnap: CanvasLayoutSnapshot = {
			itemId,
			x: item.x,
			y: item.y,
			w: before?.w ?? item.w,
			h: before?.h ?? item.h
		};
		dirtyLayoutIds.add(itemId);
		patchCanvasItems(new Map([[itemId, { w, h }]]));
		pushCanvasUndo('Resize', [beforeSnap], [{ itemId, x: item.x, y: item.y, w, h }]);
		await updateCanvasItemPosition(itemId, { x: item.x, y: item.y, w, h });
		dirtyLayoutIds.delete(itemId);
		opts.onMeaningfulActivity?.();
		if (expandedNoteId === item.noteId) {
			void bumpNeighborsAround(itemId, { w, h });
		}
	}

	async function handleCanvasAutoResize(itemId: string, w: number, h: number) {
		const item = canvasItems.find((candidate) => candidate.id === itemId);
		if (!item || (item.w === w && item.h === h)) return;
		canvasLoadSeq++;
		dirtyLayoutIds.add(itemId);
		patchCanvasItems(new Map([[itemId, { w, h }]]));
		try {
			await updateCanvasItemPosition(itemId, { x: item.x, y: item.y, w, h });
		} finally {
			dirtyLayoutIds.delete(itemId);
		}
		if (expandedNoteId === item.noteId) {
			await bumpNeighborsAround(itemId, { w, h });
		}
	}

	function handleCanvasSelectNotes(noteIds: string[], selectOpts: { additive: boolean }) {
		if (!selectOpts.additive) {
			opts.setSelection([...noteIds], noteIds[0] ?? null);
			return;
		}
		// Additive marquee always adds — never toggles off already-selected notes.
		const next = new Set(opts.getSelectionIds());
		for (const id of noteIds) next.add(id);
		const ids = [...next];
		opts.setSelection(ids, ids[0] ?? null);
	}

	function handleCanvasSelect(noteId: string, selectOpts: { additive: boolean; range: boolean }) {
		const selectedId = opts.getSelectedId();
		if (selectOpts.range && selectedId) {
			const order = spatialNoteOrder(canvasItems);
			const rangeIds = rangeBetween(order, selectedId, noteId);
			const next = new Set(selectOpts.additive ? opts.getSelectionIds() : []);
			for (const id of rangeIds) next.add(id);
			opts.setSelection([...next], noteId);
			return;
		}
		opts.toggleSelection(noteId, { additive: selectOpts.additive, range: false });
		opts.selectNote(noteId, { keepSelection: true });
	}

	async function commitCanvasBowls(bowls: CanvasBowl[]) {
		if (!activeCanvas) return;
		activeCanvas = { ...activeCanvas, bowls, modified: Date.now() };
		await updateCanvasBowls(activeCanvas.id, bowls);
		opts.onMeaningfulActivity?.();
	}

	async function createBowl(noteIds: string[], name = 'New bowl'): Promise<string | null> {
		if (!activeCanvas) return null;
		const selected = new Set(noteIds);
		const itemIds = canvasItems.filter((item) => selected.has(item.noteId)).map((item) => item.id);
		if (itemIds.length < 2) return null;
		const id = newId();
		const bowls = createBowlMembership(activeCanvas.bowls ?? [], itemIds, { id, name });
		await commitCanvasBowls(bowls);
		opts.flashToast(`Created bowl with ${itemIds.length} cards`);
		return id;
	}

	async function renameBowl(bowlId: string, name: string) {
		if (!activeCanvas) return;
		const trimmed = name.trim().slice(0, 80) || 'New bowl';
		const now = Date.now();
		const bowls = (activeCanvas.bowls ?? []).map((bowl) =>
			bowl.id === bowlId ? { ...bowl, name: trimmed, modified: now } : bowl
		);
		await commitCanvasBowls(bowls);
	}

	async function dissolveBowl(bowlId: string) {
		if (!activeCanvas) return;
		const bowls = (activeCanvas.bowls ?? []).filter((bowl) => bowl.id !== bowlId);
		await commitCanvasBowls(bowls);
		opts.flashToast('Bowl dissolved · cards stayed on the desk');
	}

	function elementSnapshot(): CanvasElement[] {
		return canvasElements.map(cloneCanvasElement);
	}

	function withoutCanvasElementsForItemIds(itemIds: ReadonlySet<string>): CanvasElement[] {
		return canvasElements
			.filter((element) => [...itemIds].every((itemId) => !canvasElementBindsItem(element, itemId)))
			.map(cloneCanvasElement);
	}

	async function createCanvasArrow(start: CanvasArrowEndpoint, end: CanvasArrowEndpoint) {
		if (!activeCanvas) return false;
		const now = Date.now();
		const element: CanvasArrowElement = {
			id: newId(),
			canvasId: activeCanvas.id,
			version: 1,
			kind: 'arrow',
			start: { ...start },
			end: { ...end },
			color: 'green',
			stroke: 'solid',
			zIndex: Math.max(0, ...canvasElements.map((candidate) => candidate.zIndex)) + 1,
			created: now,
			modified: now
		};
		const before = elementSnapshot();
		try {
			const saved = await addCanvasElement(element);
			canvasElements = [...canvasElements, saved];
			selectedCanvasElementId = saved.id;
			opts.setSelection([], null);
			canvasUndo.push({
				label: 'Connect',
				before: [],
				after: [],
				elementsBefore: before,
				elementsAfter: elementSnapshot()
			});
			canvasUndoTick++;
			opts.onMeaningfulActivity?.();
			return true;
		} catch (error) {
			console.error('Failed to create canvas arrow', error);
			opts.flashToast('Could not add connection');
			return false;
		}
	}

	async function patchCanvasArrow(
		id: string,
		patch: Partial<
			Pick<CanvasArrowElement, 'start' | 'end' | 'label' | 'color' | 'stroke' | 'zIndex'>
		>,
		label = 'Edit connection'
	) {
		const existing = canvasElements.find((element) => element.id === id);
		if (!existing || existing.kind !== 'arrow') return;
		const before = elementSnapshot();
		const saved = await updateCanvasElement(id, patch);
		if (!saved) return;
		canvasElements = canvasElements.map((element) => (element.id === id ? saved : element));
		canvasUndo.push({
			label,
			before: [],
			after: [],
			elementsBefore: before,
			elementsAfter: elementSnapshot()
		});
		canvasUndoTick++;
		opts.onMeaningfulActivity?.();
	}

	async function deleteCanvasArrow(id: string) {
		if (!canvasElements.some((element) => element.id === id)) return;
		const before = elementSnapshot();
		await removeCanvasElement(id);
		canvasElements = canvasElements.filter((element) => element.id !== id);
		if (selectedCanvasElementId === id) selectedCanvasElementId = null;
		canvasUndo.push({
			label: 'Delete connection',
			before: [],
			after: [],
			elementsBefore: before,
			elementsAfter: elementSnapshot()
		});
		canvasUndoTick++;
		opts.onMeaningfulActivity?.();
	}

	async function setCanvasSelectionColor(noteIds: string[], color?: CanvasColor) {
		const selected = new Set(noteIds);
		const before = canvasItems
			.filter((item) => selected.has(item.noteId))
			.map((item) => ({ ...item }));
		if (before.length === 0) return;
		const after = before.map((item) => {
			const next = { ...item };
			if (color) next.color = color;
			else delete next.color;
			return next;
		});
		await bulkUpdateCanvasItemColors(
			after.map((item) => item.id),
			color
		);
		const changed = new Map(after.map((item) => [item.id, item]));
		canvasItems = canvasItems.map((item) => changed.get(item.id) ?? item);
		canvasUndo.push({
			label: 'Color cards',
			before: [],
			after: [],
			itemsBefore: before,
			itemsAfter: after
		});
		canvasUndoTick++;
		opts.onMeaningfulActivity?.();
	}

	function selectBowl(bowlId: string) {
		const bowl = activeCanvas?.bowls?.find((candidate) => candidate.id === bowlId);
		if (!bowl) return;
		const itemIds = new Set(bowl.itemIds);
		const noteIds = canvasItems.filter((item) => itemIds.has(item.id)).map((item) => item.noteId);
		opts.setSelection(noteIds, noteIds[0] ?? null);
	}

	async function handleCanvasRemove(itemId: string) {
		const item = canvasItems.find((i) => i.id === itemId);
		const note = item ? opts.getNotesById().get(item.noteId) : undefined;
		await removeCanvasItem(itemId);
		opts.onMeaningfulActivity?.();
		canvasItems = canvasItems.filter((i) => i.id !== itemId);
		canvasEdges = canvasEdges.filter((e) => e.fromItemId !== itemId && e.toItemId !== itemId);
		canvasElements = canvasElements.filter((element) => !canvasElementBindsItem(element, itemId));
		if (
			selectedCanvasElementId &&
			!canvasElements.some((element) => element.id === selectedCanvasElementId)
		) {
			selectedCanvasElementId = null;
		}
		if (activeCanvas?.bowls?.some((bowl) => bowl.itemIds.includes(itemId))) {
			await commitCanvasBowls(removeItemsFromBowls(activeCanvas.bowls, [itemId]));
		}
		// Drop only undo entries that referenced this card — keep the rest.
		pruneCanvasUndo([itemId]);

		if (item && expandedNoteId === item.noteId) {
			expandedNoteId = null;
			expandFocus = null;
			restoreBumpLayout();
		}

		// Blank Untitled scratch notes shouldn't linger in the tray.
		if (item && note && isBlankUntitledNote(note)) {
			await opts.deleteBlankNote(item.noteId);
			opts.removeNoteFromSearch(item.noteId);
			opts.removeNoteFromLibrary(item.noteId);
			const ids = opts.getSelectionIds().filter((id) => id !== item.noteId);
			const selectedId =
				opts.getSelectedId() === item.noteId ? (ids[0] ?? null) : opts.getSelectedId();
			opts.setSelection(ids, selectedId);
			return;
		}

		if (item && activeCanvas && opts.getCanvasKey()) {
			dismissNoteFromCanvas(activeCanvas.id, item.noteId);
		}
	}

	/** Push neighbors clear of an expanded/resized card; remember originals for collapse. */
	async function bumpNeighborsAround(anchorId: string, size: { w: number; h: number }) {
		const anchor = canvasItems.find((i) => i.id === anchorId);
		if (!anchor) return;
		const others = canvasItems
			.filter((i) => i.id !== anchorId)
			.map((i) => {
				const s = cardDisplaySize(i, expandedNoteId);
				return { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h };
			});
		const moved = bumpOverlappingRects(
			{ id: anchor.id, x: anchor.x, y: anchor.y, w: size.w, h: size.h },
			others,
			BUMP_GAP
		);
		if (moved.size === 0) return;

		const restore = bumpRestore ?? new Map<string, { x: number; y: number }>();
		for (const cItem of canvasItems) {
			if (!moved.has(cItem.id) || restore.has(cItem.id)) continue;
			restore.set(cItem.id, { x: cItem.x, y: cItem.y });
		}
		bumpRestore = restore;

		const patches = new Map<string, { x: number; y: number }>();
		for (const [id, pos] of moved) patches.set(id, { x: pos.x, y: pos.y });
		patchCanvasItems(patches);
		settlingIds = new Set(moved.keys());
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		await bulkUpdateCanvasItemPositions(
			[...moved.entries()].map(([id, pos]) => ({ itemId: id, x: pos.x, y: pos.y }))
		);
	}

	/** Snap bumped neighbors back to their pre-expand positions. */
	async function restoreBumpLayout() {
		const restore = bumpRestore;
		bumpRestore = null;
		if (!restore || restore.size === 0) return;

		const patches = new Map<string, { x: number; y: number }>();
		for (const [id, pos] of restore) patches.set(id, { x: pos.x, y: pos.y });
		patchCanvasItems(patches);
		settlingIds = new Set(restore.keys());
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		await bulkUpdateCanvasItemPositions(
			[...restore.entries()].map(([itemId, pos]) => ({ itemId, x: pos.x, y: pos.y }))
		);
	}

	async function compactSticky(noteId: string) {
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// Expanded defaults collapse back to the canonical card size. Preserve
		// deliberately compact custom sizes rather than snapping every card.
		const tooBig = (item.w ?? 0) > COLLAPSED_CARD.w + 40 || (item.h ?? 0) > COLLAPSED_CARD.h + 40;
		if (!tooBig) return;
		const w = COLLAPSED_CARD.w;
		const h = COLLAPSED_CARD.h;
		patchCanvasItems(new Map([[item.id, { w, h }]]));
		await updateCanvasItemPosition(item.id, { x: item.x, y: item.y, w, h });
	}

	function expandSticky(noteId: string, focus: 'title' | 'body' = 'body') {
		const previousExpandedId = expandedNoteId;
		if (previousExpandedId && previousExpandedId !== noteId) {
			void restoreBumpLayout();
			void compactSticky(previousExpandedId);
		}
		opts.selectNote(noteId, { keepSelection: true });
		expandFocus = focus;
		expandedNoteId = noteId;
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// The display layer supplies expanded minimums without persisting a transient
		// size. Manual resize and one-time content fitting persist intentionally.
		const w = Math.max(item.w ?? 0, EXPANDED_CARD.w);
		const h = Math.max(item.h ?? 0, EXPANDED_CARD.h);
		void bumpNeighborsAround(item.id, { w, h });
	}

	async function collapseSticky() {
		const noteId = expandedNoteId;
		expandedNoteId = null;
		expandFocus = null;
		const restore = restoreBumpLayout();
		if (!noteId) {
			await restore;
			return;
		}
		await Promise.all([restore, compactSticky(noteId)]);
	}

	/** Tray / search / peel: ensure note is on canvas, then expand it in place. */
	async function openStickyFromTray(noteId: string) {
		if (!activeCanvas) return;
		// Supersede in-flight membership reloads so they cannot wipe this placement.
		canvasLoadSeq++;
		const existing = canvasItems.find((i) => i.noteId === noteId);
		if (!existing) {
			const spawn = canvasBoard?.getSpawnPoint(COLLAPSED_CARD, canvasItems.length) ?? {
				x: 80,
				y: 80
			};
			const item = await addNoteToCanvas(activeCanvas.id, noteId, {
				x: spawn.x,
				y: spawn.y,
				w: COLLAPSED_CARD.w,
				h: COLLAPSED_CARD.h
			});
			await refreshCanvasItems();
			settlingIds = new Set([item.id]);
			setTimeout(() => {
				settlingIds = new Set();
			}, 320);
		} else {
			canvasBoard?.ensureNoteVisible(noteId);
		}
		opts.prepareCompactOpen?.();
		expandSticky(noteId, 'body');
		requestAnimationFrame(() => canvasBoard?.frameNoteForEditing?.(noteId));
	}

	function onTrayDragStart(e: DragEvent, noteId: string) {
		const selectionSet = opts.getSelectionSet();
		const selectionIds = opts.getSelectionIds();
		const ids = selectionSet.has(noteId) && selectionIds.length > 1 ? [...selectionIds] : [noteId];
		if (!selectionSet.has(noteId)) {
			opts.setSelection([noteId], noteId);
		} else {
			opts.setSelection(selectionIds, noteId);
		}
		draggingTrayId = noteId;
		const payload = JSON.stringify(ids);
		e.dataTransfer?.setData(NOTE_MIME, payload);
		e.dataTransfer?.setData('text/plain', payload);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';

		const note = opts.getNotesById().get(noteId);
		if (note && e.dataTransfer) {
			const ghost = document.createElement('div');
			ghost.className = 'mash-note-card';
			ghost.style.cssText =
				'position:absolute;top:-999px;left:-999px;width:180px;padding:10px 12px;border-radius:12px;font:500 12px var(--mash-font-ui);';
			const title = document.createElement('div');
			title.style.cssText = 'font-weight:600;margin-bottom:4px';
			title.textContent = note.title;
			const preview = document.createElement('div');
			preview.style.cssText = 'font-size:10px;opacity:.65';
			preview.textContent = notePreview(note.body, 60);
			ghost.append(title, preview);
			document.body.appendChild(ghost);
			e.dataTransfer.setDragImage(ghost, 40, 20);
			requestAnimationFrame(() => ghost.remove());
		}
	}

	function onTrayDragEnd() {
		draggingTrayId = null;
	}

	function startTouchPlace(noteId: string, clientX: number, clientY: number) {
		touchPlaceGhost = { noteId, clientX, clientY };
		const onMove = (ev: PointerEvent) => {
			if (!touchPlaceGhost) return;
			touchPlaceGhost = { ...touchPlaceGhost, clientX: ev.clientX, clientY: ev.clientY };
		};
		const onUp = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			const ghost = touchPlaceGhost;
			touchPlaceGhost = null;
			if (!ghost || !canvasBoard?.clientToWorld) return;
			const world = canvasBoard.clientToWorld(ev.clientX, ev.clientY);
			void handleDropNotes(
				[ghost.noteId],
				world.x - COLLAPSED_CARD.w / 2,
				world.y - COLLAPSED_CARD.h / 2
			);
		};
		const onCancel = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			touchPlaceGhost = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}

	return {
		get activeCanvas() {
			return activeCanvas;
		},
		set activeCanvas(v: Canvas | null) {
			activeCanvas = v;
		},
		get canvasItems() {
			return canvasItems;
		},
		set canvasItems(v: CanvasItem[]) {
			canvasItems = v;
		},
		get canvasEdges() {
			return canvasEdges;
		},
		get canvasElements() {
			return canvasElements;
		},
		set canvasElements(v: CanvasElement[]) {
			canvasElements = v;
		},
		get selectedCanvasElementId() {
			return selectedCanvasElementId;
		},
		set selectedCanvasElementId(v: string | null) {
			selectedCanvasElementId = v;
		},
		get canvasBowls() {
			return activeCanvas?.bowls ?? [];
		},
		set canvasEdges(v: CanvasEdge[]) {
			canvasEdges = v;
		},
		get expandedNoteId() {
			return expandedNoteId;
		},
		set expandedNoteId(v: string | null) {
			expandedNoteId = v;
		},
		get expandFocus() {
			return expandFocus;
		},
		set expandFocus(v: 'title' | 'body' | null) {
			expandFocus = v;
		},
		get bumpRestore() {
			return bumpRestore;
		},
		set bumpRestore(v: Map<string, { x: number; y: number }> | null) {
			bumpRestore = v;
		},
		get settlingIds() {
			return settlingIds;
		},
		set settlingIds(v: Set<string>) {
			settlingIds = v;
		},
		get draggingTrayId() {
			return draggingTrayId;
		},
		set draggingTrayId(v: string | null) {
			draggingTrayId = v;
		},
		get touchPlaceGhost() {
			return touchPlaceGhost;
		},
		set touchPlaceGhost(v: { noteId: string; clientX: number; clientY: number } | null) {
			touchPlaceGhost = v;
		},
		get canvasUndoTick() {
			return canvasUndoTick;
		},
		set canvasUndoTick(v: number) {
			canvasUndoTick = v;
		},
		get canvasBoard() {
			return canvasBoard;
		},
		set canvasBoard(v: CanvasBoardApi | undefined) {
			canvasBoard = v;
		},
		get canCanvasUndo() {
			return canCanvasUndo;
		},
		get canCanvasRedo() {
			return canCanvasRedo;
		},
		get canvasUndoOperationId() {
			return canvasUndoOperationId;
		},
		loadContextCanvas,
		refreshCanvasItems,
		connectFlowEdge,
		disconnectFlowEdge,
		unstitchSequence,
		relayoutFlowSequences,
		handleDropNotes,
		snapshotItems,
		applyLayoutSnapshots,
		pushCanvasUndo,
		clearCanvasUndo,
		pruneCanvasUndo,
		undoCanvasLayout,
		redoCanvasLayout,
		handleCanvasMove,
		handleCanvasMoveMany,
		handleCanvasMoveEnd,
		deduplicateCanvasSelection,
		sequenceCanvasSelection,
		splitCanvasItem,
		mashCanvasItems,
		unmashCanvasItem,
		handleCanvasResize,
		handleCanvasResizeEnd,
		handleCanvasAutoResize,
		handleCanvasSelectNotes,
		handleCanvasSelect,
		createBowl,
		renameBowl,
		dissolveBowl,
		selectBowl,
		createCanvasArrow,
		patchCanvasArrow,
		deleteCanvasArrow,
		setCanvasSelectionColor,
		handleCanvasRemove,
		bumpNeighborsAround,
		restoreBumpLayout,
		expandSticky,
		collapseSticky,
		openStickyFromTray,
		onTrayDragStart,
		onTrayDragEnd,
		startTouchPlace
	};
}
