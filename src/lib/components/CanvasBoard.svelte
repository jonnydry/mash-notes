<script lang="ts">
	import type { CanvasItem, Note } from '$lib/types';
	import { notePreview } from '$lib/format';
	import { loadCanvasViewport, saveCanvasViewport, clearCanvasViewport } from '$lib/viewport';
	import {
		GRID,
		type AlignMode,
		alignRects,
		boundsOf,
		clampSize,
		fitViewport,
		loadSnapPref,
		saveSnapPref,
		snapPoint,
		snapSize
	} from '$lib/canvas-geom';
	import { Minimize2, X, AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, StretchHorizontal, StretchVertical, Layers, LayoutGrid } from 'lucide-svelte';
	import StickyEditor from '$lib/components/StickyEditor.svelte';

	const NOTE_MIME = 'application/x-mash-notes';
	const COLLAPSED_W = 220;
	const COLLAPSED_H = 120;
	const EXPANDED_W = 360;
	const EXPANDED_H = 320;
	const MASH_OVERLAP = 0.28;
	const MASH_CONFIRM_SEEN_KEY = 'mash.dragMashConfirmSeen';
	const COLLAPSED_BOUNDS = { minW: 160, minH: 96, maxW: 360, maxH: 240 };
	const EXPANDED_BOUNDS = { minW: 280, minH: 220, maxW: 640, maxH: 720 };

	function hasSeenDragMashConfirm(): boolean {
		try {
			return localStorage.getItem(MASH_CONFIRM_SEEN_KEY) === '1';
		} catch {
			return false;
		}
	}

	function markDragMashConfirmSeen() {
		try {
			localStorage.setItem(MASH_CONFIRM_SEEN_KEY, '1');
		} catch {
			/* ignore */
		}
	}

	interface Props {
		items: CanvasItem[];
		notesById: Map<string, Note>;
		selectedIds: Set<string>;
		expandedNoteId?: string | null;
		settlingIds?: Set<string>;
		canvasId?: string | null;
		onSelect: (noteId: string, opts: { additive: boolean; range: boolean }) => void;
		onSelectNotes: (noteIds: string[], opts: { additive: boolean }) => void;
		onMove: (itemId: string, x: number, y: number) => void;
		onMoveMany: (moves: Array<{ itemId: string; x: number; y: number }>) => void;
		onMoveEnd?: (
			moves: Array<{ itemId: string; x: number; y: number }>,
			before?: Array<{ itemId: string; x: number; y: number }>
		) => void;
		onResize: (itemId: string, w: number, h: number) => void;
		onResizeEnd?: (
			itemId: string,
			w: number,
			h: number,
			before?: { w: number; h: number }
		) => void;
		onRemove: (itemId: string) => void;
		onExpand: (noteId: string) => void;
		onCollapse: () => void;
		onTitleChange: (noteId: string, title: string) => void;
		onBodyChange: (noteId: string, body: string) => void;
		onDropNotes: (noteIds: string[], x: number, y: number) => void;
		onMashCards: (sourceItemId: string, targetItemId: string) => void;
		canUndo?: boolean;
		canRedo?: boolean;
		onUndo?: () => void;
		onRedo?: () => void;
	}

	let {
		items,
		notesById,
		selectedIds,
		expandedNoteId = null,
		settlingIds = new Set(),
		canvasId = null,
		onSelect,
		onSelectNotes,
		onMove,
		onMoveMany,
		onMoveEnd,
		onResize,
		onResizeEnd,
		onRemove,
		onExpand,
		onCollapse,
		onTitleChange,
		onBodyChange,
		onDropNotes,
		onMashCards,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo
	}: Props = $props();

	let boardEl: HTMLDivElement | undefined = $state();
	let panX = $state(0);
	let panY = $state(0);
	let scale = $state(1);
	let snapEnabled = $state(false);
	let altHeld = $state(false);
	let spaceHeld = $state(false);
	let isPanning = $state(false);
	let isExternalDragOver = $state(false);
	let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
	let viewportSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let appliedCanvasId: string | null = null;
	let moveRaf = 0;
	let pendingMoves: Array<{ itemId: string; x: number; y: number }> | null = null;

	let dragItemId: string | null = $state(null);
	let dragGroup = $state<Array<{ id: string; originX: number; originY: number }>>([]);
	let mashTargetId: string | null = $state(null);
	let pendingMash: { sourceId: string; targetId: string } | null = $state(null);
	let dragOrigin = { x: 0, y: 0, itemX: 0, itemY: 0 };
	let didDrag = false;

	let resizeItemId: string | null = $state(null);
	let resizeOrigin = { x: 0, y: 0, w: 0, h: 0, expanded: false };

	let marquee: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);
	let marqueeAdditive = false;

	let snapEffective = $derived(altHeld ? !snapEnabled : snapEnabled);

	function cardSize(item: CanvasItem, noteId: string): { w: number; h: number } {
		const expanded = expandedNoteId === noteId;
		if (expanded) {
			return {
				w: item.w ?? EXPANDED_W,
				h: item.h ?? EXPANDED_H
			};
		}
		return {
			w: item.w ?? COLLAPSED_W,
			h: item.h ?? COLLAPSED_H
		};
	}

	function maybeSnapPos(x: number, y: number): { x: number; y: number } {
		return snapEffective ? snapPoint(x, y) : { x, y };
	}

	function maybeSnapSize(
		w: number,
		h: number,
		expanded: boolean
	): { w: number; h: number } {
		const bounds = expanded ? EXPANDED_BOUNDS : COLLAPSED_BOUNDS;
		if (snapEffective) return snapSize(w, h, GRID, bounds);
		return clampSize(w, h, bounds);
	}

	function clientToBoard(clientX: number, clientY: number): { x: number; y: number } {
		if (!boardEl) return { x: 0, y: 0 };
		const rect = boardEl.getBoundingClientRect();
		return {
			x: (clientX - rect.left - panX) / scale,
			y: (clientY - rect.top - panY) / scale
		};
	}

	function overlapRatio(
		ax: number,
		ay: number,
		aw: number,
		ah: number,
		bx: number,
		by: number,
		bw: number,
		bh: number
	): number {
		const x1 = Math.max(ax, bx);
		const y1 = Math.max(ay, by);
		const x2 = Math.min(ax + aw, bx + bw);
		const y2 = Math.min(ay + ah, by + bh);
		const iw = Math.max(0, x2 - x1);
		const ih = Math.max(0, y2 - y1);
		const inter = iw * ih;
		if (inter <= 0) return 0;
		const smaller = Math.min(aw * ah, bw * bh);
		return smaller > 0 ? inter / smaller : 0;
	}

	function findMashTarget(moving: CanvasItem, x: number, y: number): string | null {
		if (dragGroup.length > 1) return null;
		const ms = cardSize(moving, moving.noteId);
		let best: { id: string; score: number } | null = null;
		for (const other of items) {
			if (other.id === moving.id) continue;
			const os = cardSize(other, other.noteId);
			const score = overlapRatio(x, y, ms.w, ms.h, other.x, other.y, os.w, os.h);
			if (score >= MASH_OVERLAP && (!best || score > best.score)) {
				best = { id: other.id, score };
			}
		}
		return best?.id ?? null;
	}

	function onBoardPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('[data-canvas-card]')) return;
		if (target.closest('[data-mash-confirm]')) return;
		if (target.closest('[data-canvas-chrome]')) return;

		// Pan: Space+drag or middle-click (scroll/trackpad also pans).
		// Empty-board drag: marquee select (Shift/⌘/Ctrl adds to selection).
		if (e.button === 1 || (e.button === 0 && spaceHeld)) {
			e.preventDefault();
			if (expandedNoteId) onCollapse();
			isPanning = true;
			panStart = { x: e.clientX, y: e.clientY, panX, panY };
			boardEl?.setPointerCapture(e.pointerId);
			return;
		}

		if (e.button !== 0) return;
		if (expandedNoteId) onCollapse();

		const pos = clientToBoard(e.clientX, e.clientY);
		marquee = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
		marqueeAdditive = e.shiftKey || e.metaKey || e.ctrlKey;
		boardEl?.setPointerCapture(e.pointerId);
	}

	function onBoardPointerMove(e: PointerEvent) {
		if (isPanning) {
			panX = panStart.panX + (e.clientX - panStart.x);
			panY = panStart.panY + (e.clientY - panStart.y);
			return;
		}
		if (marquee) {
			const pos = clientToBoard(e.clientX, e.clientY);
			marquee = { ...marquee, x1: pos.x, y1: pos.y };
			return;
		}
		if (resizeItemId) {
			didDrag = true;
			const dx = (e.clientX - resizeOrigin.x) / scale;
			const dy = (e.clientY - resizeOrigin.y) / scale;
			const bounds = resizeOrigin.expanded ? EXPANDED_BOUNDS : COLLAPSED_BOUNDS;
			const next = clampSize(resizeOrigin.w + dx, resizeOrigin.h + dy, bounds);
			onResize(resizeItemId, next.w, next.h);
			return;
		}
		if (dragItemId) {
			didDrag = true;
			const dx = (e.clientX - dragOrigin.x) / scale;
			const dy = (e.clientY - dragOrigin.y) / scale;
			// Continuous while dragging; snap applied on release. Coalesce to 1 frame.
			if (dragGroup.length > 1) {
				queueMoves(
					dragGroup.map((g) => ({
						itemId: g.id,
						x: g.originX + dx,
						y: g.originY + dy
					}))
				);
				mashTargetId = null;
			} else {
				const nx = dragOrigin.itemX + dx;
				const ny = dragOrigin.itemY + dy;
				queueMoves([{ itemId: dragItemId, x: nx, y: ny }]);
				const moving = items.find((i) => i.id === dragItemId);
				if (moving) {
					mashTargetId = findMashTarget(moving, nx, ny);
				}
			}
		}
	}

	function finishMarquee() {
		if (!marquee) return;
		const x1 = Math.min(marquee.x0, marquee.x1);
		const y1 = Math.min(marquee.y0, marquee.y1);
		const x2 = Math.max(marquee.x0, marquee.x1);
		const y2 = Math.max(marquee.y0, marquee.y1);
		const w = x2 - x1;
		const h = y2 - y1;
		marquee = null;
		if (w < 4 && h < 4) {
			if (!marqueeAdditive) onSelectNotes([], { additive: false });
			return;
		}
		const hit: string[] = [];
		for (const item of items) {
			const size = cardSize(item, item.noteId);
			// Rect intersection (not center-only) so partially boxed cards count.
			const overlaps =
				item.x < x2 && item.x + size.w > x1 && item.y < y2 && item.y + size.h > y1;
			if (overlaps) hit.push(item.noteId);
		}
		onSelectNotes(hit, { additive: marqueeAdditive });
	}

	function finishDrag() {
		if (moveRaf) {
			cancelAnimationFrame(moveRaf);
			flushPendingMoves();
		}
		const sourceId = dragItemId;
		const targetId = mashTargetId;
		const group = dragGroup;
		dragItemId = null;
		mashTargetId = null;
		dragGroup = [];
		if (!sourceId || !didDrag) return;

		const moves = group.map((g) => {
			const item = items.find((i) => i.id === g.id);
			const raw = item
				? { itemId: item.id, x: item.x, y: item.y }
				: { itemId: g.id, x: g.originX, y: g.originY };
			const snapped = maybeSnapPos(raw.x, raw.y);
			return { itemId: raw.itemId, x: snapped.x, y: snapped.y };
		});
		if (moves.length === 0) {
			const moved = items.find((i) => i.id === sourceId);
			if (moved) {
				const snapped = maybeSnapPos(moved.x, moved.y);
				moves.push({ itemId: sourceId, x: snapped.x, y: snapped.y });
			}
		}
		if (snapEffective) {
			onMoveMany(moves);
		}
		const before = group.map((g) => ({ itemId: g.id, x: g.originX, y: g.originY }));
		onMoveEnd?.(moves, before);

		if (group.length <= 1 && targetId && targetId !== sourceId) {
			if (hasSeenDragMashConfirm()) {
				onMashCards(sourceId, targetId);
			} else {
				pendingMash = { sourceId, targetId };
			}
		}
	}

	function finishResize() {
		const id = resizeItemId;
		const wasExpanded = resizeOrigin.expanded;
		const beforeSize = { w: resizeOrigin.w, h: resizeOrigin.h };
		resizeItemId = null;
		if (!id || !didDrag) return;
		const item = items.find((i) => i.id === id);
		if (!item) return;
		let size = cardSize(item, item.noteId);
		if (snapEffective) {
			size = maybeSnapSize(size.w, size.h, wasExpanded);
			onResize(id, size.w, size.h);
		}
		onResizeEnd?.(id, size.w, size.h, beforeSize);
	}

	function confirmPendingMash() {
		if (!pendingMash) return;
		const { sourceId, targetId } = pendingMash;
		pendingMash = null;
		markDragMashConfirmSeen();
		onMashCards(sourceId, targetId);
	}

	function cancelPendingMash() {
		if (!pendingMash) return;
		const { sourceId, targetId } = pendingMash;
		pendingMash = null;
		const source = items.find((i) => i.id === sourceId);
		const target = items.find((i) => i.id === targetId);
		if (!source || !target) return;
		// Nudge source to the right of the target so cancel doesn't leave a pile.
		const ts = cardSize(target, target.noteId);
		const snapped = maybeSnapPos(target.x + ts.w + GRID, target.y);
		const before = [{ itemId: sourceId, x: source.x, y: source.y }];
		const moves = [{ itemId: sourceId, x: snapped.x, y: snapped.y }];
		onMoveMany(moves);
		onMoveEnd?.(moves, before);
	}

	function onBoardPointerUp(e: PointerEvent) {
		if (isPanning) {
			isPanning = false;
			try {
				boardEl?.releasePointerCapture(e.pointerId);
			} catch {
				/* ignore */
			}
		}
		if (marquee) {
			finishMarquee();
			try {
				boardEl?.releasePointerCapture(e.pointerId);
			} catch {
				/* ignore */
			}
		}
		if (resizeItemId) finishResize();
		if (dragItemId) finishDrag();
	}

	function panBy(dx: number, dy: number) {
		panX += dx;
		panY += dy;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (!boardEl) return;

		// ⌘/Ctrl + scroll → zoom toward cursor
		if (e.ctrlKey || e.metaKey) {
			const rect = boardEl.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			const before = scale;
			const factor = e.deltaY > 0 ? 0.9 : 1.1;
			const next = Math.min(2, Math.max(0.4, scale * factor));
			if (next === before) return;
			panX = mx - ((mx - panX) * next) / before;
			panY = my - ((my - panY) * next) / before;
			scale = next;
			return;
		}

		// Trackpad / mouse wheel → pan the board
		const line = 16;
		const dx = e.deltaMode === 1 ? e.deltaX * line : e.deltaX;
		const dy = e.deltaMode === 1 ? e.deltaY * line : e.deltaY;
		panBy(-dx, -dy);
	}

	function startCardDrag(e: PointerEvent, item: CanvasItem) {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;
		if (
			target.closest('button') ||
			target.closest('textarea') ||
			target.closest('input') ||
			target.closest('[data-no-drag]') ||
			target.closest('[data-resize-handle]')
		) {
			return;
		}
		if (expandedNoteId === item.noteId && !target.closest('[data-drag-handle]')) {
			return;
		}
		e.stopPropagation();
		didDrag = false;
		pendingMash = null;
		dragItemId = item.id;
		mashTargetId = null;

		const noteSelected = selectedIds.has(item.noteId);
		if (noteSelected && selectedIds.size > 1) {
			dragGroup = items
				.filter((i) => selectedIds.has(i.noteId))
				.map((i) => ({ id: i.id, originX: i.x, originY: i.y }));
		} else {
			dragGroup = [{ id: item.id, originX: item.x, originY: item.y }];
		}

		dragOrigin = { x: e.clientX, y: e.clientY, itemX: item.x, itemY: item.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function endCardDrag(e: PointerEvent, item: CanvasItem) {
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		if (!didDrag && dragItemId === item.id) {
			onSelect(item.noteId, {
				additive: e.metaKey || e.ctrlKey,
				range: e.shiftKey
			});
		}
		if (dragItemId) finishDrag();
	}

	function startResize(e: PointerEvent, item: CanvasItem) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		didDrag = false;
		pendingMash = null;
		const size = cardSize(item, item.noteId);
		resizeItemId = item.id;
		resizeOrigin = {
			x: e.clientX,
			y: e.clientY,
			w: size.w,
			h: size.h,
			expanded: expandedNoteId === item.noteId
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function endResize(e: PointerEvent) {
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		if (resizeItemId) finishResize();
	}

	function handleDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes(NOTE_MIME) && !e.dataTransfer?.types.includes('text/plain')) {
			return;
		}
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		isExternalDragOver = true;
	}

	function handleDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (related && boardEl?.contains(related)) return;
		isExternalDragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isExternalDragOver = false;
		const raw =
			e.dataTransfer?.getData(NOTE_MIME) || e.dataTransfer?.getData('text/plain') || '';
		let noteIds: string[] = [];
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) noteIds = parsed.filter((id) => typeof id === 'string');
		} catch {
			if (raw) noteIds = [raw];
		}
		if (noteIds.length === 0) return;
		let pos = clientToBoard(e.clientX, e.clientY);
		pos = maybeSnapPos(pos.x, pos.y);
		onDropNotes(noteIds, pos.x, pos.y);
	}

	function flushPendingMoves() {
		moveRaf = 0;
		if (!pendingMoves || pendingMoves.length === 0) {
			pendingMoves = null;
			return;
		}
		const moves = pendingMoves;
		pendingMoves = null;
		if (moves.length === 1) {
			onMove(moves[0].itemId, moves[0].x, moves[0].y);
		} else {
			onMoveMany(moves);
		}
	}

	function queueMoves(moves: Array<{ itemId: string; x: number; y: number }>) {
		pendingMoves = moves;
		if (moveRaf) return;
		moveRaf = requestAnimationFrame(flushPendingMoves);
	}

	function flushViewportSave(forCanvasId: string | null = canvasId) {
		if (viewportSaveTimer) {
			clearTimeout(viewportSaveTimer);
			viewportSaveTimer = null;
		}
		if (!forCanvasId) return;
		saveCanvasViewport(forCanvasId, { panX, panY, scale });
	}

	function scheduleViewportSave() {
		if (!canvasId) return;
		if (viewportSaveTimer) clearTimeout(viewportSaveTimer);
		const id = canvasId;
		const snap = { panX, panY, scale };
		viewportSaveTimer = setTimeout(() => {
			viewportSaveTimer = null;
			saveCanvasViewport(id, snap);
		}, 200);
	}

	function resetView() {
		panX = 0;
		panY = 0;
		scale = 1;
		if (canvasId) clearCanvasViewport(canvasId);
	}

	function zoomToFit(selectionOnly = false) {
		if (!boardEl) return;
		const rects = items
			.filter((i) => !selectionOnly || selectedIds.has(i.noteId))
			.map((i) => {
				const s = cardSize(i, i.noteId);
				return { x: i.x, y: i.y, w: s.w, h: s.h };
			});
		const b = boundsOf(rects);
		if (!b) return;
		const view = boardEl.getBoundingClientRect();
		const next = fitViewport(
			{ minX: b.minX, minY: b.minY, width: b.width, height: b.height },
			view.width,
			view.height,
			56
		);
		panX = next.panX;
		panY = next.panY;
		scale = next.scale;
	}

	function toggleSnap() {
		snapEnabled = !snapEnabled;
		saveSnapPref(snapEnabled);
	}

	function applyAlign(mode: AlignMode) {
		const rects = items
			.filter((i) => selectedIds.has(i.noteId))
			.map((i) => {
				const s = cardSize(i, i.noteId);
				return { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h };
			});
		if (rects.length < 2) return;
		if ((mode === 'distribute-h' || mode === 'distribute-v') && rects.length < 3) return;
		const before = rects.map((r) => ({ itemId: r.id, x: r.x, y: r.y }));
		const next = alignRects(rects, mode);
		const moves = [...next.entries()].map(([itemId, pos]) => {
			const snapped = maybeSnapPos(pos.x, pos.y);
			return { itemId, x: snapped.x, y: snapped.y };
		});
		// Skip no-op updates so the UI doesn't feel broken.
		const changed = moves.filter((m) => {
			const cur = items.find((i) => i.id === m.itemId);
			return !cur || cur.x !== m.x || cur.y !== m.y;
		});
		if (changed.length === 0) return;
		onMoveMany(changed);
		onMoveEnd?.(changed, before.filter((b) => changed.some((c) => c.itemId === b.itemId)));
	}

	function nudgeSelection(dx: number, dy: number) {
		const step = snapEffective ? GRID : 1;
		const selected = items.filter((i) => selectedIds.has(i.noteId));
		const before = selected.map((i) => ({ itemId: i.id, x: i.x, y: i.y }));
		const moves = selected.map((i) => {
			const raw = { x: i.x + dx * step, y: i.y + dy * step };
			const snapped = maybeSnapPos(raw.x, raw.y);
			return { itemId: i.id, x: snapped.x, y: snapped.y };
		});
		if (moves.length === 0) return;
		onMoveMany(moves);
		onMoveEnd?.(moves, before);
	}

	$effect(() => {
		snapEnabled = loadSnapPref();
	});

	$effect(() => {
		if (!canvasId) {
			if (appliedCanvasId) flushViewportSave(appliedCanvasId);
			appliedCanvasId = null;
			return;
		}
		if (appliedCanvasId === canvasId) return;
		if (appliedCanvasId) flushViewportSave(appliedCanvasId);
		appliedCanvasId = canvasId;
		const saved = loadCanvasViewport(canvasId);
		panX = saved.panX;
		panY = saved.panY;
		scale = saved.scale;
	});

	$effect(() => {
		panX;
		panY;
		scale;
		if (!canvasId || appliedCanvasId !== canvasId) return;
		scheduleViewportSave();
	});

	$effect(() => {
		if (!pendingMash) return;
		requestAnimationFrame(() => {
			const el = boardEl?.querySelector<HTMLElement>('[data-mash-confirm]');
			el?.focus();
		});
	});

	$effect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Alt') altHeld = true;
			if (
				e.key === ' ' &&
				!(e.target instanceof HTMLInputElement) &&
				!(e.target instanceof HTMLTextAreaElement)
			) {
				spaceHeld = true;
				e.preventDefault();
			}
			if (pendingMash && e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				cancelPendingMash();
				return;
			}
			const tag = (e.target as HTMLElement)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;
			if (selectedIds.size === 0) return;
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				nudgeSelection(e.shiftKey ? -4 : -1, 0);
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				nudgeSelection(e.shiftKey ? 4 : 1, 0);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				nudgeSelection(0, e.shiftKey ? -4 : -1);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				nudgeSelection(0, e.shiftKey ? 4 : 1);
			}
		}
		function onKeyUp(e: KeyboardEvent) {
			if (e.key === 'Alt') altHeld = false;
			if (e.key === ' ') spaceHeld = false;
		}
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('keyup', onKeyUp, true);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('keyup', onKeyUp, true);
		};
	});

	let marqueeStyle = $derived.by(() => {
		if (!marquee) return null;
		const x = Math.min(marquee.x0, marquee.x1);
		const y = Math.min(marquee.y0, marquee.y1);
		const w = Math.abs(marquee.x1 - marquee.x0);
		const h = Math.abs(marquee.y1 - marquee.y0);
		return `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
	});

	let selectedCount = $derived(selectedIds.size);

	/** Cull cards far outside the viewport (keep a generous pad for smooth pan). */
	let visibleItemIds = $derived.by(() => {
		if (!boardEl || items.length < 40) {
			return new Set(items.map((i) => i.id));
		}
		const view = boardEl.getBoundingClientRect();
		const pad = 280;
		const left = (-panX - pad) / scale;
		const top = (-panY - pad) / scale;
		const right = (-panX + view.width + pad) / scale;
		const bottom = (-panY + view.height + pad) / scale;
		const ids = new Set<string>();
		for (const item of items) {
			const size = cardSize(item, item.noteId);
			const keep =
				item.x < right &&
				item.x + size.w > left &&
				item.y < bottom &&
				item.y + size.h > top;
			if (keep) ids.add(item.id);
		}
		// Always keep interactive / selected cards mounted.
		if (dragItemId) ids.add(dragItemId);
		for (const g of dragGroup) ids.add(g.id);
		if (resizeItemId) ids.add(resizeItemId);
		if (pendingMash) {
			ids.add(pendingMash.sourceId);
			ids.add(pendingMash.targetId);
		}
		if (mashTargetId) ids.add(mashTargetId);
		if (expandedNoteId) {
			const exp = items.find((i) => i.noteId === expandedNoteId);
			if (exp) ids.add(exp.id);
		}
		for (const item of items) {
			if (selectedIds.has(item.noteId)) ids.add(item.id);
		}
		return ids;
	});
</script>

<div
	bind:this={boardEl}
	class="mash-board-surface relative h-full w-full overflow-hidden select-none {isExternalDragOver
		? 'is-drop-target'
		: ''} {snapEffective ? 'is-snap-on' : ''} {isPanning || spaceHeld
		? 'cursor-grabbing'
		: 'cursor-crosshair'}"
	onpointerdown={onBoardPointerDown}
	onpointermove={onBoardPointerMove}
	onpointerup={onBoardPointerUp}
	onpointercancel={onBoardPointerUp}
	onwheel={onWheel}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	role="application"
	aria-label="Mash canvas"
>
	<div
		class="absolute top-0 left-0 origin-top-left will-change-transform"
		style="transform: translate({panX}px, {panY}px) scale({scale});"
	>
		{#each items as item (item.id)}
			{@const note = notesById.get(item.noteId)}
			{#if note && visibleItemIds.has(item.id)}
				{@const selected = selectedIds.has(note.id)}
				{@const settling = settlingIds.has(item.id)}
				{@const expanded = expandedNoteId === note.id}
				{@const size = cardSize(item, note.id)}
				{@const isDragging = dragItemId === item.id || dragGroup.some((g) => g.id === item.id)}
				{@const isMashTarget = mashTargetId === item.id}
				{@const isPendingSource = pendingMash?.sourceId === item.id}
				{@const isPendingPartner = pendingMash?.targetId === item.id}
				{@const isMash = Boolean(note.mashedFrom?.length)}
				<div
					data-canvas-card
					role="group"
					aria-label={note.title}
					data-expanded={expanded ? 'true' : undefined}
					class="mash-note-card absolute flex flex-col rounded-xl {selected
						? 'is-selected'
						: ''} {settling ? 'is-settling' : ''} {expanded
						? 'is-expanded'
						: ''} {isDragging ? 'is-dragging-card' : ''} {isMashTarget || isPendingPartner
						? 'is-mash-target'
						: ''} {isPendingSource ? 'is-mash-confirming' : ''} {isMash
						? 'is-mash-result'
						: ''}"
					style="left: {item.x}px; top: {item.y}px; width: {size.w}px; height: {size.h}px;"
					onpointerdown={(e) => startCardDrag(e, item)}
					onpointerup={(e) => endCardDrag(e, item)}
					ondblclick={(e) => {
						e.stopPropagation();
						if (!expanded) onExpand(note.id);
					}}
				>
					{#if isMashTarget && !pendingMash}
						<div
							class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[rgba(79,122,62,0.18)]"
						>
							<span
								class="mash-display rounded-full bg-[var(--mash-accent)] px-3 py-1 text-xs font-semibold text-[var(--mash-accent-ink)] shadow"
							>
								Drop to mash
							</span>
						</div>
					{/if}
					{#if isPendingSource}
						<div
							data-mash-confirm
							role="dialog"
							aria-label="Confirm mash"
							tabindex="-1"
							class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-[rgba(28,24,18,0.88)] px-3 backdrop-blur-[2px]"
							onpointerdown={(e) => e.stopPropagation()}
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => {
								if (e.key === 'Escape') {
									e.stopPropagation();
									cancelPendingMash();
								}
							}}
						>
							<p
								class="mash-display text-center text-sm font-medium"
								style="color: var(--mash-card);"
							>
								Mash these notes?
							</p>
							<div class="flex items-center gap-2">
								<button
									type="button"
									class="mash-btn rounded-lg px-3 py-1.5 text-xs font-semibold"
									onclick={(e) => {
										e.stopPropagation();
										confirmPendingMash();
									}}
								>
									Mash
								</button>
								<button
									type="button"
									class="rounded-lg border px-3 py-1.5 text-xs"
									style="border-color: rgba(240,235,227,0.25); color: var(--mash-card);"
									onclick={(e) => {
										e.stopPropagation();
										cancelPendingMash();
									}}
								>
									Cancel
								</button>
							</div>
						</div>
					{/if}
					{#if expanded}
						<div
							data-drag-handle
							class="flex cursor-grab items-center gap-1 border-b border-[rgba(80,60,30,0.12)] px-2 py-1.5 active:cursor-grabbing"
						>
							<input
								type="text"
								value={note.title}
								class="mash-focus min-w-0 flex-1 bg-transparent text-sm font-semibold tracking-tight outline-none"
								style="color: var(--mash-card-ink);"
								onpointerdown={(e) => e.stopPropagation()}
								oninput={(e) =>
									onTitleChange(note.id, (e.currentTarget as HTMLInputElement).value)}
							/>
							<button
								type="button"
								class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-black/5"
								onclick={(e) => {
									e.stopPropagation();
									onCollapse();
								}}
								aria-label="Collapse sticky"
							>
								<Minimize2 class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-black/5"
								onclick={(e) => {
									e.stopPropagation();
									onRemove(item.id);
								}}
								aria-label="Remove from canvas"
							>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>
						<div class="min-h-0 flex-1 overflow-hidden">
							<StickyEditor
								body={note.body}
								noteId={note.id}
								onBodyChange={(b) => onBodyChange(note.id, b)}
							/>
						</div>
					{:else}
						<div
							class="flex items-start justify-between gap-1 border-b border-[rgba(80,60,30,0.1)] px-2.5 py-1.5"
						>
							<span class="truncate text-xs font-semibold tracking-tight">
								{#if isMash}<span class="mr-1 text-[var(--mash-accent)]">◎</span>{/if}
								{note.title}
							</span>
							<button
								type="button"
								class="shrink-0 rounded p-0.5 text-[var(--mash-card-muted)] hover:bg-black/5 hover:text-[var(--mash-card-ink)]"
								onpointerdown={(e) => e.stopPropagation()}
								onclick={(e) => {
									e.stopPropagation();
									onRemove(item.id);
								}}
								aria-label="Remove from canvas"
							>
								<X class="h-3 w-3" />
							</button>
						</div>
						<div class="flex-1 overflow-hidden px-2.5 py-2 text-[11px] leading-snug text-[var(--mash-card-muted)]">
							{notePreview(note.body, 120)}
						</div>
					{/if}
					<div
						data-resize-handle
						class="mash-resize-handle"
						onpointerdown={(e) => startResize(e, item)}
						onpointerup={endResize}
						role="separator"
						aria-orientation="horizontal"
						aria-label="Resize card"
					></div>
				</div>
			{/if}
		{/each}

		{#if marqueeStyle}
			<div class="mash-marquee absolute" style={marqueeStyle}></div>
		{/if}
	</div>

	{#if items.length === 0}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
			<div
				class="mash-empty-state flex max-w-sm flex-col items-center text-center transition-transform duration-200
					{isExternalDragOver ? 'mash-empty-state-active scale-[1.03]' : ''}"
			>
				<img
					src="/icons/mash-empty-mascot.png"
					srcset="/icons/mash-empty-mascot.png 1x, /icons/mash-empty-mascot@2x.png 2x"
					alt=""
					width="116"
					height="200"
					class="mash-empty-mascot h-40 w-auto select-none sm:h-44"
					draggable="false"
				/>
				<p
					class="mash-display mt-4 text-xl font-medium tracking-tight text-[var(--mash-card-ink)]"
				>
					{isExternalDragOver ? 'Drop to place' : 'Drop notes here'}
				</p>
				{#if !isExternalDragOver}
					<p class="mt-1.5 max-w-[16rem] text-sm text-[var(--mash-card-muted)]">
						Drag notes from the tray onto the canvas. Double-click to edit.
					</p>
				{/if}
			</div>
		</div>
	{:else if isExternalDragOver}
		<div
			class="pointer-events-none absolute inset-0 z-10 border-2 border-[var(--mash-accent)] bg-[rgba(79,122,62,0.08)]"
		></div>
	{/if}

	<div
		data-canvas-chrome
		class="pointer-events-none absolute top-3 right-3 z-10 flex flex-wrap items-center justify-end gap-1.5"
	>
		<div
			class="pointer-events-auto flex items-center rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.92)] p-0.5 text-[10px]"
		>
			<button
				type="button"
				class="rounded px-2 py-1 {!snapEnabled
					? 'bg-[rgba(79,122,62,0.18)] font-semibold text-[var(--mash-card-ink)]'
					: 'text-[var(--mash-card-muted)]'}"
				onclick={(e) => {
					e.stopPropagation();
					if (snapEnabled) toggleSnap();
				}}
			>
				Free
			</button>
			<button
				type="button"
				class="rounded px-2 py-1 {snapEnabled
					? 'bg-[rgba(79,122,62,0.18)] font-semibold text-[var(--mash-card-ink)]'
					: 'text-[var(--mash-card-muted)]'}"
				onclick={(e) => {
					e.stopPropagation();
					if (!snapEnabled) toggleSnap();
				}}
				title="Alt temporarily flips mode"
			>
				Snap
			</button>
		</div>
		<span
			class="rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.85)] px-2 py-1 text-[10px] text-[var(--mash-card-muted)]"
		>
			{Math.round(scale * 100)}%{altHeld ? ' · Alt' : ''}
		</span>
		<button
			type="button"
			class="pointer-events-auto rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.9)] px-2 py-1 text-[10px] text-[var(--mash-card-muted)] hover:text-[var(--mash-card-ink)]"
			onclick={(e) => {
				e.stopPropagation();
				zoomToFit(false);
			}}
			title="Fit all cards"
		>
			Fit
		</button>
		{#if selectedCount > 0}
			<button
				type="button"
				class="pointer-events-auto rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.9)] px-2 py-1 text-[10px] text-[var(--mash-card-muted)] hover:text-[var(--mash-card-ink)]"
				onclick={(e) => {
					e.stopPropagation();
					zoomToFit(true);
				}}
				title="Fit selection"
			>
				Fit sel
			</button>
		{/if}
		<button
			type="button"
			class="pointer-events-auto rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.9)] px-2 py-1 text-[10px] text-[var(--mash-card-muted)] hover:text-[var(--mash-card-ink)] disabled:opacity-35"
			disabled={!canUndo}
			onclick={(e) => {
				e.stopPropagation();
				onUndo?.();
			}}
			title="Undo layout (⌘Z)"
		>
			Undo
		</button>
		<button
			type="button"
			class="pointer-events-auto rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.9)] px-2 py-1 text-[10px] text-[var(--mash-card-muted)] hover:text-[var(--mash-card-ink)] disabled:opacity-35"
			disabled={!canRedo}
			onclick={(e) => {
				e.stopPropagation();
				onRedo?.();
			}}
			title="Redo layout (⇧⌘Z)"
		>
			Redo
		</button>
		<button
			type="button"
			class="pointer-events-auto rounded-md border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.9)] px-2 py-1 text-[10px] text-[var(--mash-card-muted)] hover:text-[var(--mash-card-ink)]"
			onclick={(e) => {
				e.stopPropagation();
				resetView();
			}}
			title="Reset pan & zoom"
		>
			Reset
		</button>
	</div>

	<!-- Pan / zoom pad -->
	<div
		data-canvas-chrome
		class="pointer-events-auto absolute right-3 bottom-3 z-10 flex flex-col items-center gap-1"
	>
		<div
			class="grid grid-cols-3 gap-0.5 rounded-lg border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.94)] p-1 shadow"
		>
			<span class="col-start-2">
				<button
					type="button"
					class="mash-pan-btn"
					aria-label="Pan up"
					onclick={(e) => {
						e.stopPropagation();
						panBy(0, 80);
					}}
				>
					↑
				</button>
			</span>
			<button
				type="button"
				class="mash-pan-btn col-start-1"
				aria-label="Pan left"
				onclick={(e) => {
					e.stopPropagation();
					panBy(80, 0);
				}}
			>
				←
			</button>
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Recenter on content"
				title="Fit all"
				onclick={(e) => {
					e.stopPropagation();
					zoomToFit(false);
				}}
			>
				⌖
			</button>
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Pan right"
				onclick={(e) => {
					e.stopPropagation();
					panBy(-80, 0);
				}}
			>
				→
			</button>
			<span class="col-start-2">
				<button
					type="button"
					class="mash-pan-btn"
					aria-label="Pan down"
					onclick={(e) => {
						e.stopPropagation();
						panBy(0, -80);
					}}
				>
					↓
				</button>
			</span>
		</div>
		<div
			class="flex items-center gap-0.5 rounded-lg border border-[rgba(80,60,30,0.15)] bg-[rgba(247,241,230,0.94)] p-1 shadow"
		>
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Zoom out"
				onclick={(e) => {
					e.stopPropagation();
					if (!boardEl) return;
					const rect = boardEl.getBoundingClientRect();
					const mx = rect.width / 2;
					const my = rect.height / 2;
					const before = scale;
					const next = Math.max(0.4, scale * 0.9);
					panX = mx - ((mx - panX) * next) / before;
					panY = my - ((my - panY) * next) / before;
					scale = next;
				}}
			>
				−
			</button>
			<span class="min-w-[2.5rem] text-center text-[10px] tabular-nums text-[var(--mash-card-muted)]">
				{Math.round(scale * 100)}%
			</span>
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Zoom in"
				onclick={(e) => {
					e.stopPropagation();
					if (!boardEl) return;
					const rect = boardEl.getBoundingClientRect();
					const mx = rect.width / 2;
					const my = rect.height / 2;
					const before = scale;
					const next = Math.min(2, scale * 1.1);
					panX = mx - ((mx - panX) * next) / before;
					panY = my - ((my - panY) * next) / before;
					scale = next;
				}}
			>
				+
			</button>
		</div>
		<p class="max-w-[10rem] text-center text-[9px] leading-tight text-[var(--mash-card-muted)]">
			Drag to select · Scroll to pan · Space+drag pan · ⌘/Ctrl+scroll zoom
		</p>
	</div>

	{#if selectedCount >= 2}
		<div
			data-canvas-chrome
			class="pointer-events-auto absolute top-3 left-1/2 z-10 flex max-w-[min(92vw,40rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-[rgba(80,60,30,0.18)] bg-[rgba(247,241,230,0.96)] px-2 py-1.5 shadow-lg"
			role="toolbar"
			aria-label="Arrange selected notes"
		>
			<span class="px-1.5 text-[10px] font-medium whitespace-nowrap text-[var(--mash-card-muted)]">
				{selectedCount} selected
			</span>
			<span class="mx-0.5 hidden h-4 w-px bg-[rgba(80,60,30,0.2)] sm:block"></span>
			<span class="px-1 text-[9px] tracking-wide uppercase text-[var(--mash-card-muted)]">Align</span>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('left')}
				title="Left-align into a vertical column"
				aria-label="Align left"
			>
				<AlignLeft class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Left</span>
			</button>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('center')}
				title="Center into a vertical column"
				aria-label="Align center"
			>
				<AlignCenter class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Center</span>
			</button>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('right')}
				title="Right-align into a vertical column"
				aria-label="Align right"
			>
				<AlignRight class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Right</span>
			</button>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('top')}
				title="Top-align into a horizontal row"
				aria-label="Align top"
			>
				<AlignStartVertical class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Top</span>
			</button>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('middle')}
				title="Middle-align into a horizontal row"
				aria-label="Align middle"
			>
				<AlignCenterVertical class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Middle</span>
			</button>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('bottom')}
				title="Bottom-align into a horizontal row"
				aria-label="Align bottom"
			>
				<AlignEndVertical class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Bottom</span>
			</button>
			{#if selectedCount >= 3}
				<span class="mx-0.5 h-4 w-px bg-[rgba(80,60,30,0.2)]"></span>
				<span class="px-1 text-[9px] tracking-wide uppercase text-[var(--mash-card-muted)]">Space</span>
				<button
					type="button"
					class="mash-align-btn"
					onclick={() => applyAlign('distribute-h')}
					title="Even horizontal gaps"
					aria-label="Space evenly horizontally"
				>
					<StretchHorizontal class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Across</span>
				</button>
				<button
					type="button"
					class="mash-align-btn"
					onclick={() => applyAlign('distribute-v')}
					title="Even vertical gaps"
					aria-label="Space evenly vertically"
				>
					<StretchVertical class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Down</span>
				</button>
			{/if}
			<span class="mx-0.5 h-4 w-px bg-[rgba(80,60,30,0.2)]"></span>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('stack')}
				title="Stack into a neat pile"
				aria-label="Stack selected"
			>
				<Layers class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Stack</span>
			</button>
			<button
				type="button"
				class="mash-align-btn"
				onclick={() => applyAlign('grid')}
				title="Arrange into a grid"
				aria-label="Grid selected"
			>
				<LayoutGrid class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Grid</span>
			</button>
		</div>
	{/if}
</div>
