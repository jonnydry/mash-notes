<script lang="ts">
	import type { CanvasEdge, CanvasItem, Note } from '$lib/types';
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
		panToShowRect,
		saveSnapPref,
		snapPoint,
		snapRectsWithoutOverlap,
		resolveOverlapsKeepingFixed,
		snapSize,
		viewCenterPlacement
	} from '$lib/canvas-geom';
	import { Pin, Folder, Tag, Minimize2, Maximize2, X } from 'lucide-svelte';
	import StickyEditor from '$lib/components/StickyEditor.svelte';
	import { linkSummary } from '$lib/links';
	import {
		flowEdgePath,
		flowOutlineMarkdown,
		flowPageBadges,
		listFlowSequences
	} from '$lib/canvas-flow';
	import { printSequenceAsPdf } from '$lib/mash';
	import { exportSequencePdf as downloadSequencePdf } from '$lib/sequence-pdf';
	import {
		detectFillOrSnapZone,
		stageContentRect,
		type EditorPane,
		type SnapZone
	} from '$lib/stores/editor-stage.svelte';

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
		/** When expanding, focus title (new notes) or body (existing). */
		expandFocus?: 'title' | 'body' | null;
		settlingIds?: Set<string>;
		canvasId?: string | null;
		/** Directed flow edges between cards on this board. */
		edges?: CanvasEdge[];
		onConnectFlow?: (fromItemId: string, toItemId: string) => void | Promise<void>;
		onDisconnectFlow?: (edgeId: string) => void | Promise<void>;
		/** Clear all links in a sequence (by index in listFlowSequences). */
		onUnstitchSequence?: (seqIndex: number) => void | Promise<void>;
		/** Re-pack sequences with the current flow gap (called when entering Sequence mode). */
		onRelayoutFlow?: () => void | Promise<void>;
		/** Empty-state mascot + copy for this board (desk vs pinned). */
		emptyMascot?: {
			src: string;
			srcset?: string;
			width?: number;
			height?: number;
			title: string;
			copy: string;
		};
		onSelect: (noteId: string, opts: { additive: boolean; range: boolean }) => void;
		onSelectNotes: (noteIds: string[], opts: { additive: boolean }) => void;
		onMove: (itemId: string, x: number, y: number) => void;
		onMoveMany: (moves: Array<{ itemId: string; x: number; y: number }>) => void;
		onMoveEnd?: (
			moves: Array<{ itemId: string; x: number; y: number }>,
			before?: Array<{ itemId: string; x: number; y: number }>,
			opts?: { recordUndo?: boolean }
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
		/** Open note in the screen-space editor stage (large / split view). */
		onOpenInStage?: (noteId: string, zone?: SnapZone) => void;
		/** Live snap-zone preview while dragging a card to a screen edge. */
		onStageSnapPreview?: (zone: SnapZone | null) => void;
		/** Current stage panes — used so empty halves are full drop targets. */
		stagePanes?: EditorPane[];
		/** Live split ratios so empty-half hit testing matches a resized divider. */
		stageSplitH?: number;
		stageSplitV?: number;
		onTitleChange: (noteId: string, title: string) => void;
		onBodyChange: (noteId: string, body: string) => void;
		onMetaChange?: (
			noteId: string,
			patch: {
				folder?: string;
				tags?: string[];
				pinned?: 0 | 1;
				textAlign?: 'left' | 'center' | 'right';
			}
		) => void;
		onWikilink?: (target: string) => void;
		/** Open peel Linked for this note (links chip). */
		onOpenLinks?: (noteId: string) => void;
		folders?: string[];
		onDropNotes: (noteIds: string[], x: number, y: number) => void;
		onMashCards: (sourceItemId: string, targetItemId: string) => void;
		/** Fired when the user presses on empty board (not a card/chrome). */
		onBlankPointerDown?: () => void;
		canUndo?: boolean;
		canRedo?: boolean;
		onUndo?: () => void;
		onRedo?: () => void;
		/** Shared with Settings — bindable so dock prefs stay in sync. */
		snapEnabled?: boolean;
	}

	let {
		items,
		notesById,
		selectedIds,
		expandedNoteId = null,
		expandFocus = null,
		settlingIds = new Set(),
		canvasId = null,
		edges = [],
		onConnectFlow,
		onDisconnectFlow,
		onUnstitchSequence,
		onRelayoutFlow,
		emptyMascot = {
			src: '/icons/mash-empty-mascot.png',
			srcset: '/icons/mash-empty-mascot.png 1x, /icons/mash-empty-mascot@2x.png 2x',
			width: 116,
			height: 200,
			title: 'Drop notes here',
			copy: 'Drag notes from the tray onto the canvas. Double-click to edit.'
		},
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
		onOpenInStage,
		onStageSnapPreview,
		stagePanes = [],
		stageSplitH = 0.5,
		stageSplitV = 0.5,
		onTitleChange,
		onBodyChange,
		onMetaChange,
		onWikilink,
		onOpenLinks,
		folders = [],
		onDropNotes,
		onMashCards,
		onBlankPointerDown,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo,
		// Default from storage when unbound; parent bind:snapEnabled owns the live value.
		snapEnabled = $bindable(loadSnapPref())
	}: Props = $props();

	let boardEl: HTMLDivElement | undefined = $state();
	let panX = $state(0);
	let panY = $state(0);
	let scale = $state(1);
	let altHeld = $state(false);
	let spaceHeld = $state(false);
	let pointerOverBoard = $state(false);
	let mashConfirmBtn: HTMLButtonElement | undefined = $state();
	let titleInputEl: HTMLInputElement | undefined = $state();
	let focusedExpandId: string | null = null;
	/** Custom folder picker — native datalist mispositions under canvas transform. */
	let folderSuggestNoteId = $state<string | null>(null);
	let folderSuggestQuery = $state('');
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
	/** Screen-edge snap zone while dragging a single card toward the stage. */
	let pendingEdgeZone: SnapZone | null = $state(null);

	let resizeItemId: string | null = $state(null);
	let resizeOrigin = { x: 0, y: 0, w: 0, h: 0, expanded: false };

	let marquee: { x0: number; y0: number; x1: number; y1: number } | null = $state(null);
	let marqueeAdditive = false;

	let snapEffective = $derived(altHeld ? !snapEnabled : snapEnabled);
	let flowMode = $state(false);
	let flowFromItemId = $state<string | null>(null);

	let flowBoard = $derived(listFlowSequences(items, edges));
	let flowBadges = $derived(flowPageBadges(flowBoard.sequences));
	let flowPaths = $derived.by(() => {
		const byId = new Map(items.map((i) => [i.id, i]));
		const paths: Array<{
			id: string;
			d: string;
			midX: number;
			midY: number;
		}> = [];
		for (const edge of edges) {
			const from = byId.get(edge.fromItemId);
			const to = byId.get(edge.toItemId);
			if (!from || !to) continue;
			const fs = cardSize(from, from.noteId);
			const ts = cardSize(to, to.noteId);
			const path = flowEdgePath(
				{ x: from.x, y: from.y, w: fs.w, h: fs.h },
				{ x: to.x, y: to.y, w: ts.w, h: ts.h }
			);
			paths.push({ id: edge.id, ...path });
		}
		return paths;
	});

	function exitFlowMode() {
		flowMode = false;
		flowFromItemId = null;
	}

	/** Prefer an explicit index; otherwise the first valid sequence. */
	function resolveExportSeqIndex(preferred = 0): number {
		const seqs = flowBoard.sequences;
		if (seqs.length === 0) return -1;
		const pref = seqs[preferred];
		if (pref && !pref.invalid && pref.pages.length > 0) return preferred;
		const firstValid = seqs.findIndex((s) => !s.invalid && s.pages.length > 0);
		return firstValid;
	}

	function notesForSequence(seqIndex: number): { notes: Note[]; title: string } | null {
		const seq = flowBoard.sequences[seqIndex];
		if (!seq || seq.invalid || seq.pages.length === 0) return null;
		const notes = seq.pages
			.map((p) => notesById.get(p.noteId))
			.filter((n): n is Note => Boolean(n));
		if (notes.length === 0) return null;
		const title =
			flowBoard.sequences.length > 1
				? `Sequence ${seqIndex + 1}`
				: notes[0]?.title?.trim() || 'Page sequence';
		return { notes, title };
	}

	async function exportSequencePdf(seqIndex = 0) {
		const idx = resolveExportSeqIndex(seqIndex);
		if (idx < 0) return;
		const payload = notesForSequence(idx);
		if (!payload) return;
		try {
			const ok = await downloadSequencePdf(payload.notes, payload.title);
			if (!ok) {
				console.error('Export PDF failed');
				return;
			}
			exitFlowMode();
		} catch (e) {
			console.error(e);
		}
	}

	function printSequence(seqIndex = 0) {
		const idx = resolveExportSeqIndex(seqIndex);
		if (idx < 0) return;
		const payload = notesForSequence(idx);
		if (!payload) return;
		try {
			printSequenceAsPdf(payload.notes, payload.title);
		} catch (e) {
			console.error(e);
		}
	}

	let canExportAnySequence = $derived(
		flowBoard.sequences.some((s) => !s.invalid && s.pages.length > 0)
	);

	$effect(() => {
		if (!expandedNoteId || folderSuggestNoteId !== expandedNoteId) {
			if (folderSuggestNoteId && folderSuggestNoteId !== expandedNoteId) {
				folderSuggestNoteId = null;
			}
		}
	});

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

	/** Prefer the live stage element so snap zones match dock-inset panes. */
	function stageSnapRect() {
		if (!boardEl) return null;
		const stageEl = boardEl.parentElement?.querySelector('.mash-editor-stage');
		if (stageEl) return stageEl.getBoundingClientRect();
		const board = boardEl.getBoundingClientRect();
		const mobile =
			typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
		return stageContentRect(board, { mobile });
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
		if (target.closest('[data-flow-edge]')) return;

		if (flowFromItemId) {
			flowFromItemId = null;
			onBlankPointerDown?.();
			return;
		}

		onBlankPointerDown?.();

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
		if (flowMode) return;
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
				pendingEdgeZone = null;
				onStageSnapPreview?.(null);
			} else {
				const nx = dragOrigin.itemX + dx;
				const ny = dragOrigin.itemY + dy;
				queueMoves([{ itemId: dragItemId, x: nx, y: ny }]);
				const moving = items.find((i) => i.id === dragItemId);
				if (moving) {
					mashTargetId = findMashTarget(moving, nx, ny);
				}
				if (boardEl && onOpenInStage && !mashTargetId) {
					const rect = stageSnapRect();
					const zone = rect
						? detectFillOrSnapZone(e.clientX, e.clientY, rect, stagePanes, {
								h: stageSplitH,
								v: stageSplitV
							})
						: null;
					pendingEdgeZone = zone;
					onStageSnapPreview?.(zone);
				} else {
					pendingEdgeZone = null;
					onStageSnapPreview?.(null);
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
		if (!sourceId || !didDrag) {
			onStageSnapPreview?.(null);
			return;
		}

		// Edge snap → open in editor stage (single-card drag only).
		if (group.length <= 1 && boardEl && onOpenInStage) {
			const rect = boardEl.getBoundingClientRect();
			// Use last known pointer from the event path via board center fallback:
			// finishDrag is also called from pointerup; prefer client coords if available.
			const zone = pendingEdgeZone;
			pendingEdgeZone = null;
			onStageSnapPreview?.(null);
			if (zone) {
				const item = items.find((i) => i.id === sourceId);
				if (item) {
					// Revert optimistic move — stage owns the edit surface.
					const origin = group[0];
					if (origin) {
						onMoveMany([{ itemId: sourceId, x: origin.originX, y: origin.originY }]);
					}
					onOpenInStage(item.noteId, zone);
					return;
				}
			}
			void rect;
		} else {
			pendingEdgeZone = null;
			onStageSnapPreview?.(null);
		}

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

		const willMash = group.length <= 1 && Boolean(targetId) && targetId !== sourceId;
		const mashImmediate = willMash && hasSeenDragMashConfirm();
		const beforeById = new Map(group.map((g) => [g.id, { x: g.originX, y: g.originY }]));

		// Snap mode: land dragged cards on the lattice, then only bump
		// neighbors that collide — avoid full-board reorganize.
		if (snapEffective && !willMash) {
			const byMove = new Map(moves.map((m) => [m.itemId, m]));
			const movedIds = new Set(byMove.keys());
			const rects = items.map((i) => {
				const s = cardSize(i, i.noteId);
				const m = byMove.get(i.id);
				return {
					id: i.id,
					x: m?.x ?? i.x,
					y: m?.y ?? i.y,
					w: s.w,
					h: s.h
				};
			});
			const organized = resolveOverlapsKeepingFixed(rects, movedIds, GRID);
			const allMoves: Array<{ itemId: string; x: number; y: number }> = [];
			for (const m of moves) {
				const bumped = organized.get(m.itemId);
				allMoves.push({
					itemId: m.itemId,
					x: bumped?.x ?? m.x,
					y: bumped?.y ?? m.y
				});
			}
			for (const [itemId, pos] of organized) {
				if (movedIds.has(itemId)) continue;
				allMoves.push({ itemId, x: pos.x, y: pos.y });
			}
			const changed = allMoves.filter((m) => {
				const origin = beforeById.get(m.itemId);
				const cur = items.find((i) => i.id === m.itemId);
				const fromX = origin?.x ?? cur?.x;
				const fromY = origin?.y ?? cur?.y;
				return fromX !== m.x || fromY !== m.y;
			});
			if (changed.length > 0) {
				const before = changed.map((m) => {
					const origin = beforeById.get(m.itemId);
					const cur = items.find((i) => i.id === m.itemId)!;
					return {
						itemId: m.itemId,
						x: origin?.x ?? cur.x,
						y: origin?.y ?? cur.y
					};
				});
				onMoveMany(changed);
				onMoveEnd?.(changed, before);
			}
			return;
		}

		if (snapEffective) {
			onMoveMany(moves);
		}
		const before = group.map((g) => ({ itemId: g.id, x: g.originX, y: g.originY }));
		// Immediate mash clears the undo stack — don't leave a stale move entry.
		// First-time confirm keeps the move so Cancel → Undo can restore.
		onMoveEnd?.(moves, before, { recordUndo: !mashImmediate });

		if (willMash && targetId) {
			if (mashImmediate) {
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

	function findCardScrollTarget(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof Element)) return null;
		// Collapsed preview, expanded body textarea, or any marked scroll region.
		return target.closest<HTMLElement>('textarea, [data-card-scroll]');
	}

	function canScrollElement(el: HTMLElement, deltaX: number, deltaY: number): boolean {
		const style = getComputedStyle(el);
		const oy = style.overflowY;
		const ox = style.overflowX;
		const canY =
			(oy === 'auto' || oy === 'scroll' || oy === 'overlay' || el instanceof HTMLTextAreaElement) &&
			el.scrollHeight > el.clientHeight + 1;
		const canX =
			(ox === 'auto' || ox === 'scroll' || ox === 'overlay') && el.scrollWidth > el.clientWidth + 1;
		if (Math.abs(deltaY) >= Math.abs(deltaX)) {
			if (!canY) return false;
			if (deltaY < 0 && el.scrollTop > 0) return true;
			if (deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
			return false;
		}
		if (!canX) return false;
		if (deltaX < 0 && el.scrollLeft > 0) return true;
		if (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
		return false;
	}

	function onWheel(e: WheelEvent) {
		if (!boardEl) return;

		// ⌘/Ctrl + scroll → zoom toward cursor
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
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

		const line = 16;
		const dx = e.deltaMode === 1 ? e.deltaX * line : e.deltaX;
		const dy = e.deltaMode === 1 ? e.deltaY * line : e.deltaY;

		// Inside a note (collapsed preview or expanded editor): let it scroll first.
		const scrollEl = findCardScrollTarget(e.target);
		if (scrollEl && canScrollElement(scrollEl, dx, dy)) {
			return;
		}

		e.preventDefault();
		// Trackpad / mouse wheel → pan the board
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
			target.closest('[data-resize-handle]') ||
			target.closest('[data-flow-edge]')
		) {
			return;
		}
		if (flowMode) {
			e.stopPropagation();
			e.preventDefault();
			if (!flowFromItemId) {
				flowFromItemId = item.id;
			} else if (flowFromItemId === item.id) {
				flowFromItemId = null;
			} else {
				const from = flowFromItemId;
				flowFromItemId = null;
				void onConnectFlow?.(from, item.id);
			}
			return;
		}
		if (expandedNoteId === item.noteId && !target.closest('[data-drag-handle]')) {
			return;
		}
		e.stopPropagation();
		didDrag = false;
		pendingMash = null;
		pendingEdgeZone = null;
		onStageSnapPreview?.(null);
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

	/** Board-space top-left for a new card in the current viewport. */
	export function getSpawnPoint(
		size: { w: number; h: number },
		cascadeIndex = 0
	): { x: number; y: number } {
		const view = boardEl?.getBoundingClientRect();
		const viewW = view?.width ?? 800;
		const viewH = view?.height ?? 600;
		const existing = items.map((i) => {
			const s = cardSize(i, i.noteId);
			return { x: i.x, y: i.y, w: s.w, h: s.h };
		});
		return viewCenterPlacement({
			panX,
			panY,
			scale,
			viewW,
			viewH,
			cardW: size.w,
			cardH: size.h,
			index: cascadeIndex,
			existing
		});
	}

	/** Soft-pan so an existing note's card is comfortably on screen (keeps scale). */
	export function ensureNoteVisible(noteId: string): void {
		if (!boardEl) return;
		const item = items.find((i) => i.noteId === noteId);
		if (!item) return;
		const s = cardSize(item, noteId);
		const view = boardEl.getBoundingClientRect();
		const next = panToShowRect(
			{ x: item.x, y: item.y, w: s.w, h: s.h },
			{ panX, panY, scale, viewW: view.width, viewH: view.height },
			56
		);
		if (next.panX === panX && next.panY === panY) return;
		panX = next.panX;
		panY = next.panY;
	}

	/** Convert a client (screen) point to board world coordinates. */
	export function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
		if (!boardEl) return { x: 0, y: 0 };
		const rect = boardEl.getBoundingClientRect();
		return {
			x: (clientX - rect.left - panX) / scale,
			y: (clientY - rect.top - panY) / scale
		};
	}

	function toggleSnap() {
		snapEnabled = !snapEnabled;
		saveSnapPref(snapEnabled);
	}

	/** Snap every card to the grid and push overlaps apart (undoable Arrange). */
	export function organizeToSnap() {
		if (items.length === 0) return;
		const rects = items.map((i) => {
			const s = cardSize(i, i.noteId);
			return { id: i.id, x: i.x, y: i.y, w: s.w, h: s.h };
		});
		const next = snapRectsWithoutOverlap(rects);
		const before = rects.map((r) => ({ itemId: r.id, x: r.x, y: r.y }));
		const moves = [...next.entries()].map(([itemId, pos]) => ({
			itemId,
			x: pos.x,
			y: pos.y
		}));
		const changed = moves.filter((m) => {
			const cur = items.find((i) => i.id === m.itemId);
			return !cur || cur.x !== m.x || cur.y !== m.y;
		});
		if (changed.length === 0) return;
		onMoveMany(changed);
		onMoveEnd?.(
			changed,
			before.filter((b) => changed.some((c) => c.itemId === b.itemId))
		);
	}

	/**
	 * Autocomplete for existing folder paths — not a required picker.
	 * Hide when the only hit is exactly what's already typed (avoids echo menus).
	 */
	function folderSuggestions(query: string, currentFolder: string): string[] {
		const q = query.trim().toLowerCase();
		if (!q) {
			// On focus: other folders you can switch to (skip current).
			return folders.filter((f) => f !== currentFolder).slice(0, 8);
		}
		return folders
			.filter((f) => {
				const fl = f.toLowerCase();
				if (fl === q) return false; // exact typed match — no echo
				return fl.includes(q);
			})
			.slice(0, 8);
	}

	function openFolderSuggest(noteId: string, current: string) {
		folderSuggestNoteId = noteId;
		folderSuggestQuery = current;
	}

	function closeFolderSuggest() {
		folderSuggestNoteId = null;
	}

	function pickFolder(noteId: string, folder: string) {
		onMetaChange?.(noteId, { folder });
		folderSuggestQuery = folder;
		closeFolderSuggest();
	}

	/** Align / arrange selected cards (also used by the page selection bar). */
	export function applyAlign(mode: AlignMode) {
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
		if (!expandedNoteId || expandFocus !== 'title') {
			if (!expandedNoteId) focusedExpandId = null;
			return;
		}
		if (focusedExpandId === expandedNoteId) return;
		focusedExpandId = expandedNoteId;
		requestAnimationFrame(() => {
			titleInputEl?.focus();
			titleInputEl?.select();
		});
	});

	$effect(() => {
		if (!pendingMash) return;
		requestAnimationFrame(() => mashConfirmBtn?.focus());

		function onConfirmKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				cancelPendingMash();
				return;
			}
			if (e.key !== 'Tab') return;
			const root = boardEl?.querySelector<HTMLElement>('[data-mash-confirm]');
			if (!root) return;
			const focusable = [
				...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
			].filter((el) => !el.hasAttribute('disabled'));
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (e.shiftKey) {
				if (active === first || !root.contains(active)) {
					e.preventDefault();
					last.focus();
				}
			} else if (active === last || !root.contains(active)) {
				e.preventDefault();
				first.focus();
			}
		}
		window.addEventListener('keydown', onConfirmKey, true);
		return () => window.removeEventListener('keydown', onConfirmKey, true);
	});

	$effect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Alt') altHeld = true;
			if (e.key === 'Escape' && (flowFromItemId || flowMode)) {
				e.preventDefault();
				if (flowFromItemId) {
					flowFromItemId = null;
					return;
				}
				exitFlowMode();
				return;
			}
			if (
				e.key === ' ' &&
				pointerOverBoard &&
				!(e.target instanceof HTMLInputElement) &&
				!(e.target instanceof HTMLTextAreaElement) &&
				!(e.target instanceof HTMLElement && e.target.isContentEditable)
			) {
				spaceHeld = true;
				e.preventDefault();
			}
			if (pendingMash) return;
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
	onpointerenter={() => {
		pointerOverBoard = true;
	}}
	onpointerleave={() => {
		pointerOverBoard = false;
		if (!isPanning) spaceHeld = false;
	}}
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
				{@const links = linkSummary([...notesById.values()], note)}
				{@const pageBadge = flowBadges.get(item.id)}
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
						: ''} {flowFromItemId === item.id ? 'is-flow-source' : ''} {flowMode
						? 'is-flow-mode'
						: ''}"
					style="left: {item.x}px; top: {item.y}px; width: {size.w}px; height: {size.h}px;"
					onpointerdown={(e) => startCardDrag(e, item)}
					onpointerup={(e) => endCardDrag(e, item)}
					ondblclick={(e) => {
						e.stopPropagation();
						if (flowMode) return;
						if (!expanded) {
							if (onOpenInStage) onOpenInStage(note.id, 'maximize');
							else onExpand(note.id);
						}
					}}
				>
					{#if pageBadge}
						<span
							class="mash-flow-page-badge"
							title={flowBoard.sequences.length > 1
								? `Sequence ${pageBadge.sequence}, page ${pageBadge.page}`
								: `Page ${pageBadge.page}`}
						>
							{flowBoard.sequences.length > 1
								? `${pageBadge.sequence}.${pageBadge.page}`
								: `p${pageBadge.page}`}
						</span>
					{/if}
					{#if isMashTarget && !pendingMash}
						<div
							class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[var(--mash-accent-wash)]"
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
							role="alertdialog"
							aria-modal="true"
							aria-labelledby="mash-drag-confirm-title"
							tabindex="-1"
							class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-[var(--mash-panel)] px-3 backdrop-blur-[2px]"
							onpointerdown={(e) => e.stopPropagation()}
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
						>
							<p
								id="mash-drag-confirm-title"
								class="mash-display text-center text-sm font-medium"
								style="color: var(--mash-ink);"
							>
								Mash these notes?
							</p>
							<div class="flex items-center gap-2">
								<button
									bind:this={mashConfirmBtn}
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
									style="border-color: var(--mash-glass-border); color: var(--mash-ink);"
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
							class="flex cursor-grab items-center gap-1 border-b border-[var(--mash-card-edge)] px-2 py-1.5 active:cursor-grabbing"
						>
							<input
								bind:this={titleInputEl}
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
								class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)] {note.pinned === 1
									? 'text-[var(--mash-accent)]'
									: ''}"
								onclick={(e) => {
									e.stopPropagation();
									onMetaChange?.(note.id, { pinned: note.pinned === 1 ? 0 : 1 });
								}}
								aria-label={note.pinned === 1 ? 'Unpin note' : 'Pin note'}
								title={note.pinned === 1 ? 'Unpin' : 'Pin'}
							>
								<Pin class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)]"
								onclick={(e) => {
									e.stopPropagation();
									onOpenInStage?.(note.id, 'maximize');
								}}
								aria-label="Open large editor"
								title="Open large editor"
							>
								<Maximize2 class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)]"
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
								class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)]"
								onclick={(e) => {
									e.stopPropagation();
									onRemove(item.id);
								}}
								aria-label="Remove from canvas"
							>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>
						<div
							class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--mash-card-edge)] px-2 py-1"
							data-no-drag
							role="group"
							aria-label="Note metadata"
							onpointerdown={(e) => e.stopPropagation()}
						>
							<div class="relative flex min-w-0 flex-1 items-center gap-1 text-[10px] text-[var(--mash-card-muted)]">
								<Folder class="h-3 w-3 shrink-0" />
								<input
									type="text"
									value={note.folder}
									placeholder="Folder path…"
									title="Type a folder path, or pick an existing one"
									autocomplete="off"
									class="mash-focus min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 text-[11px] outline-none"
									style="color: var(--mash-card-ink);"
									onfocus={() => openFolderSuggest(note.id, note.folder)}
									oninput={(e) => {
										const folder = (e.currentTarget as HTMLInputElement).value;
										folderSuggestQuery = folder;
										folderSuggestNoteId = note.id;
										onMetaChange?.(note.id, { folder });
									}}
									onkeydown={(e) => {
										if (e.key === 'Escape') {
											e.stopPropagation();
											closeFolderSuggest();
											(e.currentTarget as HTMLInputElement).blur();
										}
										if (e.key === 'Enter') {
											const hits = folderSuggestions(folderSuggestQuery, note.folder);
											if (hits.length === 1) {
												e.preventDefault();
												pickFolder(note.id, hits[0]);
											} else {
												closeFolderSuggest();
											}
										}
									}}
									onblur={() => {
										setTimeout(() => {
											if (folderSuggestNoteId === note.id) closeFolderSuggest();
										}, 120);
									}}
								/>
								{#if folderSuggestNoteId === note.id}
									{@const hits = folderSuggestions(folderSuggestQuery, note.folder)}
									{#if hits.length > 0 || note.folder}
										<ul
											class="absolute top-full left-0 z-30 mt-0.5 max-h-32 min-w-full overflow-auto rounded border py-0.5"
											style="border-color: var(--mash-paper-chip-border); background: var(--mash-paper-chip); box-shadow: var(--mash-shadow-card);"
											role="listbox"
											aria-label="Existing folders"
										>
											{#if note.folder}
												<li role="option" aria-selected="false">
													<button
														type="button"
														class="block w-full truncate px-2 py-1 text-left text-[10px] text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)]"
														onmousedown={(e) => {
															e.preventDefault();
															pickFolder(note.id, '');
														}}
													>
														Clear folder
													</button>
												</li>
											{/if}
											{#each hits as folder}
												<li role="option" aria-selected="false">
													<button
														type="button"
														class="block w-full truncate px-2 py-1 text-left text-[11px] text-[var(--mash-card-ink)] hover:bg-[var(--mash-card-hover)]"
														onmousedown={(e) => {
															e.preventDefault();
															pickFolder(note.id, folder);
														}}
													>
														{folder}
													</button>
												</li>
											{/each}
										</ul>
									{/if}
								{/if}
							</div>
							<label class="flex min-w-[40%] flex-1 items-center gap-1 text-[10px] text-[var(--mash-card-muted)]">
								<Tag class="h-3 w-3 shrink-0" />
								<input
									type="text"
									value={note.tags.join(', ')}
									placeholder="tags, comma, separated"
									class="mash-focus min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 text-[11px] outline-none"
									style="color: var(--mash-card-ink);"
									oninput={(e) => {
										const raw = (e.currentTarget as HTMLInputElement).value;
										const tags = raw
											.split(',')
											.map((t) => t.trim())
											.filter(Boolean);
										onMetaChange?.(note.id, { tags });
									}}
								/>
							</label>
							{#if links.outgoingCount + links.backlinkCount > 0}
								<button
									type="button"
									class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)] hover:text-[var(--mash-accent)]"
									title="{links.outgoingCount} links · {links.backlinkCount} backlinks — open Linked"
									aria-label="{links.outgoingCount} links, {links.backlinkCount} backlinks"
									onclick={(e) => {
										e.stopPropagation();
										onOpenLinks?.(note.id);
									}}
								>
									{#if links.outgoingCount > 0 && links.backlinkCount > 0}
										{links.outgoingCount} · {links.backlinkCount}
									{:else if links.outgoingCount > 0}
										{links.outgoingCount} link{links.outgoingCount === 1 ? '' : 's'}
									{:else}
										{links.backlinkCount} backlink{links.backlinkCount === 1 ? '' : 's'}
									{/if}
								</button>
							{/if}
						</div>
						<div class="min-h-0 flex-1 overflow-hidden">
							<StickyEditor
								body={note.body}
								noteId={note.id}
								textAlign={note.textAlign}
								autofocus={expandFocus !== 'title'}
								onBodyChange={(b) => onBodyChange(note.id, b)}
								onTextAlignChange={(align) => onMetaChange?.(note.id, { textAlign: align })}
								onWikilink={(target) => onWikilink?.(target)}
							/>
						</div>
					{:else}
						<div
							class="mash-card-title-row flex items-start justify-between gap-1 border-b border-[var(--mash-card-edge)] px-2.5 py-1.5"
						>
							<span class="flex min-w-0 items-center gap-1 truncate text-xs font-semibold tracking-tight">
								{#if note.pinned === 1}
									<Pin class="h-3 w-3 shrink-0 text-[var(--mash-accent)]" />
								{/if}
								{#if isMash}<span class="mr-0.5 text-[var(--mash-accent)]">◎</span>{/if}
								<span class="truncate">{note.title}</span>
							</span>
							<button
								type="button"
								class="shrink-0 rounded p-0.5 text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)] hover:text-[var(--mash-card-ink)]"
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
						<div
							data-card-scroll
							class="mash-card-preview min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2 text-[11px] leading-snug text-[var(--mash-card-muted)]"
							style="text-align: {note.textAlign === 'center' || note.textAlign === 'right'
								? note.textAlign
								: 'left'};"
							onwheel={(e) => e.stopPropagation()}
						>
							{notePreview(note.body, 220)}
						</div>
					{/if}
					<div
						data-resize-handle
						class="mash-resize-handle"
						onpointerdown={(e) => startResize(e, item)}
						onpointerup={endResize}
						role="button"
						tabindex="-1"
						aria-label="Resize card"
					></div>
				</div>
			{/if}
		{/each}

		{#if marqueeStyle}
			<div class="mash-marquee absolute" style={marqueeStyle}></div>
		{/if}

		{#if flowPaths.length > 0}
			<svg
				class="pointer-events-none absolute top-0 left-0 overflow-visible"
				width="1"
				height="1"
				aria-hidden="true"
			>
				<defs>
					<marker
						id="mash-flow-arrow"
						markerWidth="8"
						markerHeight="8"
						refX="6"
						refY="3"
						orient="auto"
						markerUnits="strokeWidth"
					>
						<path d="M0,0 L6,3 L0,6 Z" fill="var(--mash-accent)" />
					</marker>
				</defs>
				{#each flowPaths as path (path.id)}
					<path
						d={path.d}
						fill="none"
						stroke="var(--mash-accent)"
						stroke-width="2"
						stroke-linecap="round"
						marker-end="url(#mash-flow-arrow)"
						opacity="0.9"
					/>
				{/each}
			</svg>
			{#each flowPaths as path (path.id)}
				<button
					type="button"
					data-flow-edge
					class="mash-flow-edge-hit absolute z-[4] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--mash-accent)] bg-[var(--mash-card)] text-[10px] font-bold text-[var(--mash-accent)] shadow"
					style="left: {path.midX}px; top: {path.midY}px; width: 18px; height: 18px;"
					title="Remove flow link"
					aria-label="Remove flow link"
					onclick={(e) => {
						e.stopPropagation();
						void onDisconnectFlow?.(path.id);
					}}
				>
					×
				</button>
			{/each}
		{/if}
	</div>

	{#if items.length === 0}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
			<div
				class="mash-empty-state flex max-w-sm flex-col items-center text-center transition-transform duration-200
					{isExternalDragOver ? 'mash-empty-state-active scale-[1.03]' : ''}"
			>
				<img
					src={emptyMascot.src}
					srcset={emptyMascot.srcset}
					alt=""
					width={emptyMascot.width ?? 116}
					height={emptyMascot.height ?? 200}
					class="mash-empty-mascot h-40 w-auto select-none sm:h-44"
					draggable="false"
				/>
				<p class="mash-display mash-empty-title mt-4 text-xl font-medium tracking-tight">
					{isExternalDragOver ? 'Drop to place' : emptyMascot.title}
				</p>
				{#if !isExternalDragOver}
					<p class="mash-empty-copy mt-1.5 max-w-[16rem] text-sm">
						{emptyMascot.copy}
					</p>
				{/if}
			</div>
		</div>
	{:else if isExternalDragOver}
		<div
			class="pointer-events-none absolute inset-0 z-10 border-2 border-[var(--mash-accent)] bg-[var(--mash-accent-wash)]"
		></div>
	{/if}

	<div
		data-canvas-chrome
		class="mash-canvas-chrome-top pointer-events-none absolute top-3 right-3 z-10 flex flex-wrap items-center justify-end gap-1.5"
	>
		<div
			class="mash-board-chip pointer-events-auto flex items-center rounded-md p-0.5 text-[10px]"
		>
			<button
				type="button"
				class="mash-board-chip-btn rounded px-2 py-1 {!snapEnabled ? 'is-active' : ''}"
				onclick={(e) => {
					e.stopPropagation();
					if (snapEnabled) toggleSnap();
				}}
				title="Free placement — no grid snap while dragging"
			>
				Free
			</button>
			<button
				type="button"
				class="mash-board-chip-btn rounded px-2 py-1 {snapEnabled ? 'is-active' : ''}"
				onclick={(e) => {
					e.stopPropagation();
					if (!snapEnabled) toggleSnap();
				}}
				title="Snap future drags to the grid (Alt flips temporarily)"
			>
				Snap
			</button>
		</div>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px]"
			onclick={(e) => {
				e.stopPropagation();
				organizeToSnap();
			}}
			title="Snap all cards to the grid and clear overlaps"
			disabled={items.length === 0}
		>
			Organize
		</button>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px] {flowMode
				? 'is-active'
				: ''}"
			onclick={(e) => {
				e.stopPropagation();
				if (flowMode) exitFlowMode();
				else {
					flowMode = true;
					flowFromItemId = null;
					void onRelayoutFlow?.();
				}
			}}
			title={flowMode
				? 'Done — exit sequence mode'
				: 'Link next page (multiple sequences per board)'}
			aria-pressed={flowMode}
		>
			{flowMode
				? flowFromItemId
					? 'Pick next page…'
					: 'Done'
				: 'Sequence'}
		</button>
		<span
			class="mash-board-chip-soft rounded-md px-2 py-1 text-[10px]"
		>
			{Math.round(scale * 100)}%{altHeld ? ' · Alt' : ''}
		</span>
		<button
			type="button"
			class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px]"
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
				class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px]"
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
			class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px] disabled:opacity-35"
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
			class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px] disabled:opacity-35"
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
			class="mash-board-chip mash-board-chip-btn pointer-events-auto rounded-md px-2 py-1 text-[10px]"
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
		class="mash-canvas-chrome-pan pointer-events-auto absolute right-3 bottom-3 z-10 flex flex-col items-center gap-1"
	>
		<div
			class="mash-board-chip grid grid-cols-3 gap-0.5 rounded-lg p-1 shadow"
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
			class="mash-board-chip flex items-center gap-0.5 rounded-lg p-1 shadow"
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
			<span class="min-w-[2.5rem] text-center text-[10px] tabular-nums text-[var(--mash-chrome-muted)]">
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
		<p class="mash-chrome-hint max-w-[10rem] text-center text-[9px] leading-tight text-[var(--mash-chrome-muted)]">
			{#if flowMode}
				Click A then B · snaps in order · Unstitch clears links · Export PDF downloads a file
			{:else}
				Drag to select · Edge = half editor · Drop into empty half to split · ⌘/Ctrl+scroll zoom
			{/if}
		</p>
	</div>

	{#if edges.length > 0}
		<div
			data-canvas-chrome
			class="mash-flow-strip pointer-events-auto absolute bottom-3 left-[4.75rem] z-10 rounded-xl px-3 py-2 shadow"
		>
			<div class="mb-1.5 flex items-center justify-between gap-2">
				<span class="text-[10px] font-semibold tracking-wide uppercase text-[var(--mash-accent-bright)]">
					{flowBoard.sequences.length === 1
						? `Sequence · ${flowBoard.sequences[0].pages.length}p`
						: `${flowBoard.sequences.length} sequences`}
				</span>
				<div class="flex items-center gap-1">
					{#if flowMode}
						<button
							type="button"
							class="mash-board-chip-btn rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mash-chrome-muted)] hover:text-[var(--mash-chrome-ink)]"
							onclick={(e) => {
								e.stopPropagation();
								exitFlowMode();
							}}
							title="Finish linking pages"
						>
							Done
						</button>
					{/if}
					{#if flowBoard.sequences.length === 1}
						<button
							type="button"
							class="mash-board-chip-btn rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mash-chrome-muted)] hover:text-[var(--mash-chrome-ink)]"
							onclick={(e) => {
								e.stopPropagation();
								void onUnstitchSequence?.(0);
							}}
							title="Remove all links in this sequence"
						>
							Unstitch
						</button>
					{/if}
					<button
						type="button"
						class="mash-board-chip-btn rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mash-accent-bright)] hover:text-[var(--mash-chrome-ink)]"
						onclick={(e) => {
							e.stopPropagation();
							void exportSequencePdf(0);
						}}
						title="Download PDF — one note per page"
						disabled={!canExportAnySequence}
					>
						Export PDF
					</button>
					<button
						type="button"
						class="mash-board-chip-btn rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mash-chrome-muted)] hover:text-[var(--mash-chrome-ink)]"
						onclick={(e) => {
							e.stopPropagation();
							printSequence(0);
						}}
						title="Open print preview (Save as PDF from the dialog)"
						disabled={!canExportAnySequence}
					>
						Print…
					</button>
					<button
						type="button"
						class="mash-board-chip-btn rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mash-chrome-muted)] hover:text-[var(--mash-chrome-ink)]"
						onclick={async (e) => {
							e.stopPropagation();
							const md = flowOutlineMarkdown(flowBoard.sequences, notesById);
							try {
								await navigator.clipboard.writeText(md);
							} catch {
								/* ignore */
							}
						}}
						title="Copy page outline(s)"
					>
						Copy
					</button>
				</div>
			</div>
			{#each flowBoard.sequences as seq, si (seq.id)}
				<div class="mash-flow-seq" class:is-invalid={seq.invalid}>
					{#if flowBoard.sequences.length > 1 || seq.invalid}
						<p class="mash-flow-seq-label">
							Seq {si + 1}{#if seq.invalid}
								<span class="warn"> · fix links</span>{/if}
							<button
								type="button"
								class="mash-board-chip-btn ml-1 rounded px-1 py-0 text-[9px] font-semibold text-[var(--mash-chrome-muted)] hover:text-[var(--mash-chrome-ink)]"
								onclick={(e) => {
									e.stopPropagation();
									void onUnstitchSequence?.(si);
								}}
								title="Remove all links in this sequence"
							>
								Unstitch
							</button>
							{#if !seq.invalid}
								<button
									type="button"
									class="mash-board-chip-btn ml-1 rounded px-1 py-0 text-[9px] font-semibold text-[var(--mash-accent-bright)]"
									onclick={(e) => {
										e.stopPropagation();
										void exportSequencePdf(si);
									}}
									title="Download this sequence as PDF"
								>
									PDF
								</button>
								<button
									type="button"
									class="mash-board-chip-btn ml-1 rounded px-1 py-0 text-[9px] font-semibold text-[var(--mash-chrome-muted)]"
									onclick={(e) => {
										e.stopPropagation();
										printSequence(si);
									}}
									title="Print this sequence"
								>
									Print
								</button>
							{/if}
						</p>
					{/if}
					<ol class="mash-flow-strip-list">
						{#each seq.pages as item, i (item.id)}
							{@const note = notesById.get(item.noteId)}
							<li>
								<span class="n">{i + 1}.</span>
								<span class="t">{note?.title ?? 'Untitled'}</span>
							</li>
						{/each}
					</ol>
				</div>
			{/each}
			{#if flowBoard.orphans.length > 0}
				<p class="mt-1.5 text-[9px] text-[var(--mash-chrome-muted)]">
					{flowBoard.orphans.length} card{flowBoard.orphans.length === 1 ? '' : 's'} not in a
					sequence
				</p>
			{/if}
		</div>
	{/if}

</div>
