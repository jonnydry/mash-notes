/**
 * Canvas session — card helpers + reactive board / layout / sticky store.
 */
import { untrack } from 'svelte';
import {
	addCanvasEdge,
	addNoteToCanvas,
	getCanvasItems,
	getOrCreateFolderCanvas,
	listCanvasEdges,
	removeCanvasEdge,
	removeCanvasItem,
	removeNotesFromCanvas,
	replaceCanvasEdges,
	updateCanvasItemPosition
} from '$lib/db';
import type { Canvas, CanvasEdge, CanvasItem, Note } from '$lib/types';
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
import type { SnapZone } from '$lib/stores/editor-stage.svelte';

export const COLLAPSED_CARD = { w: 220, h: 120 };
export const EXPANDED_CARD = { w: 360, h: 320 };
export const BUMP_GAP = 24;
export const NOTE_MIME = 'application/x-mash-notes';

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

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export type CanvasBoardApi = {
	getSpawnPoint: (
		size: { w: number; h: number },
		cascadeIndex?: number
	) => { x: number; y: number };
	ensureNoteVisible: (noteId: string) => void;
	applyAlign: (mode: AlignMode) => void;
	organizeToSnap?: () => void;
	clientToWorld?: (clientX: number, clientY: number) => { x: number; y: number };
};

export type CreateCanvasSessionOpts = {
	flashToast: (msg: string) => void;
	getNotes: () => Note[];
	getNotesById: () => Map<string, Note>;
	/** Dexie canvas.folder key ('' desk, folder path, or PINNED_CANVAS_KEY). */
	getCanvasKey: () => string;
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
	/** Open a note in the screen-space editor (preferred over sticky expand). */
	openNoteInStage?: (noteId: string, zone?: SnapZone) => void;
};

export function createCanvasSession(opts: CreateCanvasSessionOpts) {
	let activeCanvas = $state<Canvas | null>(null);
	let canvasItems = $state<CanvasItem[]>([]);
	let canvasEdges = $state<CanvasEdge[]>([]);
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
	const canvasUndo = new CanvasUndoStack();

	const canCanvasUndo = $derived.by(() => {
		canvasUndoTick;
		return canvasUndo.canUndo;
	});
	const canCanvasRedo = $derived.by(() => {
		canvasUndoTick;
		return canvasUndo.canRedo;
	});

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
		const key = opts.getCanvasKey();
		membershipKey;
		// untrack: canvasUndoTick++ both reads and writes — would infinite-loop the effect.
		untrack(() => {
			canvasUndo.clear();
			canvasUndoTick++;
			bumpRestore = null;
		});
		void loadContextCanvas(key);
	});

	async function loadContextCanvas(key: string) {
		const seq = ++canvasLoadSeq;
		try {
			const canvas = await getOrCreateFolderCanvas(key);
			if (seq !== canvasLoadSeq) return;
			activeCanvas = canvas;
			let items = await getCanvasItems(canvas.id);
			if (seq !== canvasLoadSeq) return;

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
			// Preserve optimistic drag/resize positions if a reload races mid-gesture.
			const localById = new Map(canvasItems.map((i) => [i.id, i]));
			canvasItems = items.map((item) => {
				const local = localById.get(item.id);
				if (!local) return item;
				if (local.x !== item.x || local.y !== item.y || local.w !== item.w || local.h !== item.h) {
					return { ...item, x: local.x, y: local.y, w: local.w, h: local.h };
				}
				return item;
			});
			canvasEdges = await listCanvasEdges(canvas.id);
			if (seq !== canvasLoadSeq) return;
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
		}
	}

	async function refreshCanvasItems() {
		if (!activeCanvas) return;
		canvasItems = await getCanvasItems(activeCanvas.id);
		canvasEdges = await listCanvasEdges(activeCanvas.id);
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
			toRemove.length === 1 ? 'Sequence unstitched' : `Unstitched ${toRemove.length} links`
		);
		return toRemove.length;
	}

	async function handleDropNotes(noteIds: string[], x: number, y: number) {
		if (!activeCanvas || noteIds.length === 0) return;
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
		const byId = new Map(snaps.map((s) => [s.itemId, s]));
		canvasItems = canvasItems.map((item) => {
			const s = byId.get(item.id);
			return s ? { ...item, x: s.x, y: s.y, w: s.w, h: s.h } : item;
		});
		await Promise.all(
			snaps.map((s) => updateCanvasItemPosition(s.itemId, { x: s.x, y: s.y, w: s.w, h: s.h }))
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
		if (entry.before.length > 0) {
			await applyLayoutSnapshots(entry.before);
		}
		if (entry.edgesBefore) {
			await applyEdgeSnapshots(entry.edgesBefore);
		}
		opts.flashToast(`Undo ${entry.label}`);
	}

	async function redoCanvasLayout() {
		const entry = canvasUndo.redo();
		canvasUndoTick++;
		if (!entry) return;
		if (entry.after.length > 0) {
			await applyLayoutSnapshots(entry.after);
		}
		if (entry.edgesAfter) {
			await applyEdgeSnapshots(entry.edgesAfter);
		}
		opts.flashToast(`Redo ${entry.label}`);
	}

	function handleCanvasMove(itemId: string, x: number, y: number) {
		// Optimistic only — persist on drag end to avoid IndexedDB thrash.
		canvasItems = canvasItems.map((item) => (item.id === itemId ? { ...item, x, y } : item));
	}

	function handleCanvasMoveMany(moves: Array<{ itemId: string; x: number; y: number }>) {
		const byId = new Map(moves.map((m) => [m.itemId, m]));
		canvasItems = canvasItems.map((item) => {
			const m = byId.get(item.id);
			return m ? { ...item, x: m.x, y: m.y } : item;
		});
	}

	async function handleCanvasMoveEnd(
		moves: Array<{ itemId: string; x: number; y: number }>,
		before?: Array<{ itemId: string; x: number; y: number }>,
		moveOpts?: { recordUndo?: boolean }
	) {
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
			pushCanvasUndo(moves.length > 1 ? 'Arrange' : 'Move', beforeSnaps, afterSnaps);
		}
		await Promise.all(moves.map((m) => updateCanvasItemPosition(m.itemId, { x: m.x, y: m.y })));
	}

	function handleCanvasResize(itemId: string, w: number, h: number) {
		canvasItems = canvasItems.map((item) => (item.id === itemId ? { ...item, w, h } : item));
	}

	async function handleCanvasResizeEnd(
		itemId: string,
		w: number,
		h: number,
		before?: { w: number; h: number }
	) {
		const item = canvasItems.find((i) => i.id === itemId);
		if (!item) return;
		const beforeSnap: CanvasLayoutSnapshot = {
			itemId,
			x: item.x,
			y: item.y,
			w: before?.w ?? item.w,
			h: before?.h ?? item.h
		};
		canvasItems = canvasItems.map((i) => (i.id === itemId ? { ...i, w, h } : i));
		pushCanvasUndo('Resize', [beforeSnap], [{ itemId, x: item.x, y: item.y, w, h }]);
		await updateCanvasItemPosition(itemId, { x: item.x, y: item.y, w, h });
		if (expandedNoteId === item.noteId) {
			void bumpNeighborsAround(itemId, { w, h });
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

	async function handleCanvasRemove(itemId: string) {
		const item = canvasItems.find((i) => i.id === itemId);
		const note = item ? opts.getNotesById().get(item.noteId) : undefined;
		await removeCanvasItem(itemId);
		canvasItems = canvasItems.filter((i) => i.id !== itemId);
		canvasEdges = canvasEdges.filter((e) => e.fromItemId !== itemId && e.toItemId !== itemId);
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

		canvasItems = canvasItems.map((cItem) => {
			const next = moved.get(cItem.id);
			return next ? { ...cItem, x: next.x, y: next.y } : cItem;
		});
		settlingIds = new Set(moved.keys());
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		await Promise.all(
			[...moved.entries()].map(([id, pos]) => updateCanvasItemPosition(id, { x: pos.x, y: pos.y }))
		);
	}

	/** Snap bumped neighbors back to their pre-expand positions. */
	async function restoreBumpLayout() {
		const restore = bumpRestore;
		bumpRestore = null;
		if (!restore || restore.size === 0) return;

		canvasItems = canvasItems.map((item) => {
			const prev = restore.get(item.id);
			return prev ? { ...item, x: prev.x, y: prev.y } : item;
		});
		settlingIds = new Set(restore.keys());
		setTimeout(() => {
			settlingIds = new Set();
		}, 320);
		await Promise.all(
			[...restore.entries()].map(([itemId, pos]) =>
				updateCanvasItemPosition(itemId, { x: pos.x, y: pos.y })
			)
		);
	}

	function expandSticky(noteId: string, focus: 'title' | 'body' = 'body') {
		if (expandedNoteId && expandedNoteId !== noteId) {
			void restoreBumpLayout();
		}
		opts.selectNote(noteId, { keepSelection: true });
		expandFocus = focus;
		expandedNoteId = noteId;
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// Grow to at least expanded defaults; keep larger custom sizes.
		const w = Math.max(item.w ?? 0, EXPANDED_CARD.w);
		const h = Math.max(item.h ?? 0, EXPANDED_CARD.h);
		if (w !== item.w || h !== item.h) {
			canvasItems = canvasItems.map((i) => (i.id === item.id ? { ...i, w, h } : i));
			void updateCanvasItemPosition(item.id, { x: item.x, y: item.y, w, h });
		}
		void bumpNeighborsAround(item.id, { w, h });
	}

	function collapseSticky() {
		const noteId = expandedNoteId;
		expandedNoteId = null;
		expandFocus = null;
		void restoreBumpLayout();
		if (!noteId) return;
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// Shrink oversized expanded cards back to a compact default; keep intentional small sizes.
		const tooBig = (item.w ?? 0) > COLLAPSED_CARD.w + 40 || (item.h ?? 0) > COLLAPSED_CARD.h + 40;
		if (!tooBig) return;
		const w = COLLAPSED_CARD.w;
		const h = COLLAPSED_CARD.h;
		canvasItems = canvasItems.map((i) => (i.id === item.id ? { ...i, w, h } : i));
		void updateCanvasItemPosition(item.id, { x: item.x, y: item.y, w, h });
	}

	/** Tray / search / peel: ensure note is on canvas, then open in the stage editor. */
	async function openStickyFromTray(noteId: string) {
		if (!activeCanvas) return;
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
		opts.selectNote(noteId, { keepSelection: true });
		if (opts.openNoteInStage) opts.openNoteInStage(noteId, 'maximize');
		else expandSticky(noteId, 'body');
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
			ghost.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(note.title)}</div><div style="font-size:10px;opacity:.65">${escapeHtml(notePreview(note.body, 60))}</div>`;
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
		handleCanvasResize,
		handleCanvasResizeEnd,
		handleCanvasSelectNotes,
		handleCanvasSelect,
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
