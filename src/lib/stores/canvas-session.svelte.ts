/**
 * Canvas session — card helpers + reactive board / layout / sticky store.
 */
import { untrack } from 'svelte';
import {
	addNoteToCanvas,
	getCanvasItems,
	getOrCreateFolderCanvas,
	removeCanvasItem,
	removeNotesFromCanvas,
	updateCanvasItemPosition
} from '$lib/db';
import type { Canvas, CanvasItem, Note } from '$lib/types';
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
import { bumpOverlappingRects, type AlignMode } from '$lib/canvas-geom';

export const COLLAPSED_CARD = { w: 220, h: 120 };
export const EXPANDED_CARD = { w: 360, h: 320 };
export const BUMP_GAP = 16;
export const NOTE_MIME = 'application/x-mash-notes';

export type CardSize = { w: number; h: number };

export function cardDisplaySize(
	item: CanvasItem,
	expandedNoteId: string | null
): CardSize {
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
	getSpawnPoint: (size: { w: number; h: number }, cascadeIndex?: number) => { x: number; y: number };
	ensureNoteVisible: (noteId: string) => void;
	applyAlign: (mode: AlignMode) => void;
	clientToWorld?: (clientX: number, clientY: number) => { x: number; y: number };
};

export type CreateCanvasSessionOpts = {
	flashToast: (msg: string) => void;
	getNotes: () => Note[];
	getNotesById: () => Map<string, Note>;
	getCanvasFolder: () => string;
	getSelectionIds: () => string[];
	getSelectionSet: () => Set<string>;
	getSelectedId: () => string | null;
	setSelection: (ids: string[], selectedId: string | null) => void;
	selectNote: (id: string, opts?: { keepSelection?: boolean }) => void;
	toggleSelection: (id: string, opts?: { additive?: boolean; range?: boolean }) => void;
	deleteBlankNote: (id: string) => Promise<void>;
	removeNoteFromSearch: (id: string) => void;
	removeNoteFromLibrary: (id: string) => void;
};

export function createCanvasSession(opts: CreateCanvasSessionOpts) {
	let activeCanvas = $state<Canvas | null>(null);
	let canvasItems = $state<CanvasItem[]>([]);
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

	const folderMembershipKey = $derived.by(() => {
		const folder = opts.getCanvasFolder();
		if (!folder) return '';
		return opts
			.getNotes()
			.filter((n) => n.folder === folder || n.folder.startsWith(folder + '/'))
			.map((n) => n.id)
			.sort()
			.join(',');
	});

	/** Re-run canvas load when folder context or folder membership changes. */
	$effect(() => {
		const folder = opts.getCanvasFolder();
		folderMembershipKey;
		// untrack: canvasUndoTick++ both reads and writes — would infinite-loop the effect.
		untrack(() => {
			canvasUndo.clear();
			canvasUndoTick++;
			bumpRestore = null;
		});
		void loadContextCanvas(folder);
	});

	async function loadContextCanvas(folder: string) {
		const seq = ++canvasLoadSeq;
		try {
			const canvas = await getOrCreateFolderCanvas(folder);
			if (seq !== canvasLoadSeq) return;
			activeCanvas = canvas;
			let items = await getCanvasItems(canvas.id);
			if (seq !== canvasLoadSeq) return;

			// Folder canvases mirror membership: add missing notes, prune leavers.
			// Notes the user removed from the board stay dismissed until dropped back.
			if (folder) {
				const folderNotes = opts
					.getNotes()
					.filter((n) => n.folder === folder || n.folder.startsWith(folder + '/'));
				const folderNoteIds = new Set(folderNotes.map((n) => n.id));
				const dismissed = getDismissedNoteIds(canvas.id);
				const staleIds = items
					.filter((i) => !folderNoteIds.has(i.noteId))
					.map((i) => i.noteId);
				if (staleIds.length > 0) {
					await removeNotesFromCanvas(canvas.id, staleIds);
					if (seq !== canvasLoadSeq) return;
					items = items.filter((i) => folderNoteIds.has(i.noteId));
				}

				const onCanvas = new Set(items.map((i) => i.noteId));
				const missing = folderNotes.filter(
					(n) => !onCanvas.has(n.id) && !dismissed.has(n.id)
				);
				if (missing.length > 0) {
					await Promise.all(
						missing.map((note, i) => {
							const idx = items.length + i;
							return addNoteToCanvas(canvas.id, note.id, {
								x: 40 + (idx % 4) * 240,
								y: 40 + Math.floor(idx / 4) * 160,
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
				if (
					local.x !== item.x ||
					local.y !== item.y ||
					local.w !== item.w ||
					local.h !== item.h
				) {
					return { ...item, x: local.x, y: local.y, w: local.w, h: local.h };
				}
				return item;
			});
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
		}
	}

	async function refreshCanvasItems() {
		if (!activeCanvas) return;
		canvasItems = await getCanvasItems(activeCanvas.id);
	}

	async function handleDropNotes(noteIds: string[], x: number, y: number) {
		if (!activeCanvas || noteIds.length === 0) return;
		undismissNotesFromCanvas(activeCanvas.id, noteIds);
		const placed: string[] = [];
		for (let i = 0; i < noteIds.length; i++) {
			const dropX = x + i * 28;
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
		opts.flashToast(`Dropped ${noteIds.length} on canvas`);
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

	function applyLayoutSnapshots(snaps: CanvasLayoutSnapshot[]) {
		const byId = new Map(snaps.map((s) => [s.itemId, s]));
		canvasItems = canvasItems.map((item) => {
			const s = byId.get(item.id);
			return s ? { ...item, x: s.x, y: s.y, w: s.w, h: s.h } : item;
		});
		void Promise.all(
			snaps.map((s) =>
				updateCanvasItemPosition(s.itemId, { x: s.x, y: s.y, w: s.w, h: s.h })
			)
		);
	}

	function pushCanvasUndo(
		label: string,
		before: CanvasLayoutSnapshot[],
		after: CanvasLayoutSnapshot[]
	) {
		canvasUndo.push({ label, before, after });
		canvasUndoTick++;
	}

	function clearCanvasUndo() {
		canvasUndo.clear();
		canvasUndoTick++;
	}

	function undoCanvasLayout() {
		const entry = canvasUndo.undo();
		canvasUndoTick++;
		if (!entry) return;
		applyLayoutSnapshots(entry.before);
		opts.flashToast(`Undo ${entry.label}`);
	}

	function redoCanvasLayout() {
		const entry = canvasUndo.redo();
		canvasUndoTick++;
		if (!entry) return;
		applyLayoutSnapshots(entry.after);
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
		await Promise.all(
			moves.map((m) => updateCanvasItemPosition(m.itemId, { x: m.x, y: m.y }))
		);
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
			bumpNeighborsAround(itemId, { w, h });
		}
	}

	function handleCanvasSelectNotes(noteIds: string[], selectOpts: { additive: boolean }) {
		if (!selectOpts.additive) {
			opts.setSelection([...noteIds], noteIds[0] ?? null);
			return;
		}
		const next = new Set(opts.getSelectionIds());
		for (const id of noteIds) {
			if (next.has(id)) next.delete(id);
			else next.add(id);
		}
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
		// Layout undo snapshots may reference the removed card — drop the stack.
		clearCanvasUndo();

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

		if (item && activeCanvas && opts.getCanvasFolder()) {
			dismissNoteFromCanvas(activeCanvas.id, item.noteId);
		}
	}

	/** Push neighbors clear of an expanded/resized card; remember originals for collapse. */
	function bumpNeighborsAround(anchorId: string, size: { w: number; h: number }) {
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
		void Promise.all(
			[...moved.entries()].map(([id, pos]) =>
				updateCanvasItemPosition(id, { x: pos.x, y: pos.y })
			)
		);
	}

	/** Snap bumped neighbors back to their pre-expand positions. */
	function restoreBumpLayout() {
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
		void Promise.all(
			[...restore.entries()].map(([itemId, pos]) =>
				updateCanvasItemPosition(itemId, { x: pos.x, y: pos.y })
			)
		);
	}

	function expandSticky(noteId: string, focus: 'title' | 'body' = 'body') {
		if (expandedNoteId && expandedNoteId !== noteId) {
			restoreBumpLayout();
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
		bumpNeighborsAround(item.id, { w, h });
	}

	function collapseSticky() {
		const noteId = expandedNoteId;
		expandedNoteId = null;
		expandFocus = null;
		restoreBumpLayout();
		if (!noteId) return;
		const item = canvasItems.find((i) => i.noteId === noteId);
		if (!item) return;
		// Shrink oversized expanded cards back to a compact default; keep intentional small sizes.
		const tooBig =
			(item.w ?? 0) > COLLAPSED_CARD.w + 40 || (item.h ?? 0) > COLLAPSED_CARD.h + 40;
		if (!tooBig) return;
		const w = COLLAPSED_CARD.w;
		const h = COLLAPSED_CARD.h;
		canvasItems = canvasItems.map((i) => (i.id === item.id ? { ...i, w, h } : i));
		void updateCanvasItemPosition(item.id, { x: item.x, y: item.y, w, h });
	}

	/** Tray double-click: ensure note is on canvas, then expand as sticky. */
	async function openStickyFromTray(noteId: string) {
		if (!activeCanvas) return;
		const existing = canvasItems.find((i) => i.noteId === noteId);
		if (!existing) {
			const spawn =
				canvasBoard?.getSpawnPoint(EXPANDED_CARD, canvasItems.length) ?? {
					x: 80,
					y: 80
				};
			const item = await addNoteToCanvas(activeCanvas.id, noteId, {
				x: spawn.x,
				y: spawn.y,
				w: EXPANDED_CARD.w,
				h: EXPANDED_CARD.h
			});
			await refreshCanvasItems();
			settlingIds = new Set([item.id]);
			setTimeout(() => {
				settlingIds = new Set();
			}, 320);
		} else {
			canvasBoard?.ensureNoteVisible(noteId);
		}
		expandSticky(noteId, 'body');
	}

	function onTrayDragStart(e: DragEvent, noteId: string) {
		const selectionSet = opts.getSelectionSet();
		const selectionIds = opts.getSelectionIds();
		const ids =
			selectionSet.has(noteId) && selectionIds.length > 1 ? [...selectionIds] : [noteId];
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
			window.removeEventListener('pointercancel', onUp);
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
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
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
		handleDropNotes,
		snapshotItems,
		applyLayoutSnapshots,
		pushCanvasUndo,
		clearCanvasUndo,
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
