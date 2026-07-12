<script lang="ts">
	import type { CanvasEdge, CanvasItem, Note } from '$lib/types';
	import { SvelteSet } from 'svelte/reactivity';
	import { notePreview } from '$lib/format';
	import { parseEmbeddedNoteImage } from '$lib/markdown';
	import {
		loadCanvasViewport,
		saveCanvasViewport,
		clearCanvasViewport,
		mobileAutoFitKey
	} from '$lib/viewport';
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
		snapSize,
		viewCenterPlacement
	} from '$lib/canvas-geom';
	import {
		Pin,
		Minimize2,
		Maximize2,
		X,
		FileUp,
		FileText,
		MoreHorizontal
	} from 'lucide-svelte';
	import { focusTrap } from '$lib/focus-trap';
	import StickyEditor from '$lib/components/StickyEditor.svelte';
	import FolderSuggestField from '$lib/components/FolderSuggestField.svelte';
	import TagSuggestField from '$lib/components/TagSuggestField.svelte';
	import { buildLinkSummaryMap } from '$lib/links';
	import { isPermanentMashWelcomeNote, MASH_SPOON_LOGO } from '$lib/canvas-empty-state';
	import {
		flowEdgePath,
		flowOutlineMarkdown,
		flowPageBadges,
		invalidSequenceEdgeIds,
		listFlowSequences
	} from '$lib/canvas-flow';
	import { printSequenceAsPdf } from '$lib/mash';
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
	const POINTER_DRAG_THRESHOLD = 4;
	const MIN_SCALE = 0.4;
	const MAX_SCALE = 2;
	const ZOOM_BUTTON_FACTOR = 1.1;
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
		/** Primary selected note — receives tabindex=0 for keyboard focus. */
		primarySelectedId?: string | null;
		expandedNoteId?: string | null;
		/** When expanding, focus title (new notes) or body (existing). */
		expandFocus?: 'title' | 'body' | null;
		settlingIds?: Set<string>;
		canvasId?: string | null;
		/** Directed flow edges between cards on this board. */
		edges?: CanvasEdge[];
		onConnectFlow?: (fromItemId: string, toItemId: string) => boolean | Promise<boolean>;
		onDisconnectFlow?: (edgeId: string) => void | Promise<void>;
		/** Clear all links in a sequence (by index in listFlowSequences). */
		onUnstitchSequence?: (seqIndex: number) => void | Promise<void>;
		/** Re-pack sequences with the current flow gap (called when entering Sequence mode). */
		onRelayoutFlow?: () => boolean | Promise<boolean>;
		/** Clear note selection (used when entering Sequence so Mash/Align don’t stack). */
		onClearSelection?: () => void;
		/** Brief status toast (Snap overlap hint, Copy outline, etc.). */
		onToast?: (msg: string) => void;
		/** Empty-state mascot + copy for this board (desk vs pinned). */
		emptyMascot?: {
			src: string;
			srcset?: string;
			width?: number;
			height?: number;
			title: string;
			copy: string;
		};
		/** Override whether the board mascot/guidance is visible behind cards. */
		showEmptyState?: boolean;
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
		onResizeEnd?: (itemId: string, w: number, h: number, before?: { w: number; h: number }) => void;
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
		tags?: string[];
		onDropNotes: (noteIds: string[], x: number, y: number) => void;
		/** Import files dragged in from the operating system at this canvas position. */
		onDropFiles?: (files: File[], x: number, y: number) => void | Promise<void>;
		onMashCards: (sourceItemId: string, targetItemId: string) => void;
		/** Fired when the user presses on empty board (not a card/chrome). */
		onBlankPointerDown?: () => void;
		canUndo?: boolean;
		canRedo?: boolean;
		onUndo?: () => void;
		onRedo?: () => void;
		/** Open the keyboard shortcuts overlay. */
		onOpenShortcuts?: () => void;
		/** Shared with Settings — bindable so dock prefs stay in sync. */
		snapEnabled?: boolean;
	}

	let {
		items,
		notesById,
		selectedIds,
		primarySelectedId = null,
		expandedNoteId = null,
		expandFocus = null,
		settlingIds = new Set(),
		canvasId = null,
		edges = [],
		onConnectFlow,
		onDisconnectFlow,
		onUnstitchSequence,
		onRelayoutFlow,
		onClearSelection,
		onToast,
		emptyMascot = {
			src: '/icons/mash-empty-mascot.png',
			srcset: '/icons/mash-empty-mascot.png 1x, /icons/mash-empty-mascot@2x.png 2x',
			width: 116,
			height: 200,
			title: 'Paste, drop, or type',
			copy: 'Press ⌘/Ctrl+V for text, drop files, or use New note.'
		},
		showEmptyState,
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
		tags = [],
		onDropNotes,
		onDropFiles,
		onMashCards,
		onBlankPointerDown,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo,
		onOpenShortcuts,
		// Default from storage when unbound; parent bind:snapEnabled owns the live value.
		snapEnabled = $bindable(loadSnapPref())
	}: Props = $props();

	let boardEl: HTMLDivElement | undefined = $state();
	let boardWidth = $state(0);
	let boardHeight = $state(0);
	let panX = $state(0);
	let panY = $state(0);
	let scale = $state(1);
	let altHeld = $state(false);
	let spaceHeld = $state(false);
	let pointerOverBoard = $state(false);
	let titleInputEl: HTMLInputElement | undefined = $state();
	let focusedExpandId: string | null = null;
	let isPanning = $state(false);
	let isExternalDragOver = $state(false);
	let isFileDragOver = $state(false);
	let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
	let viewportSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let appliedCanvasId: string | null = null;
	let isMobileViewport = $state(false);
	let mobileViewportEntry = $state(0);
	let mobileViewportEntrySeed = 0;
	let lastMobileAutoFitKey: string | null = null;
	let lastOffscreenFitKey: string | null = null;
	let mobileToolsOpen = $state(false);
	/** Desktop board chrome: secondary tools under View. */
	let desktopViewOpen = $state(false);
	let moveRaf = 0;
	let pendingMoves: Array<{ itemId: string; x: number; y: number }> | null = null;

	let dragItemId: string | null = $state(null);
	let dragGroup = $state<Array<{ id: string; originX: number; originY: number }>>([]);
	let dragSelectionIntent: {
		noteId: string;
		additive: boolean;
		initiallySelected: boolean;
	} | null = null;
	let dragStageRect: { left: number; top: number; width: number; height: number } | null = null;
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
	let emptyStateVisible = $derived(
		showEmptyState ?? items.every((item) => !notesById.has(item.noteId))
	);
	let linkSummaries = $derived(buildLinkSummaryMap([...notesById.values()]));
	let pendingMashCopy = $derived.by(() => {
		if (!pendingMash) return null;
		const sourceItem = items.find((item) => item.id === pendingMash?.sourceId);
		const targetItem = items.find((item) => item.id === pendingMash?.targetId);
		const source = sourceItem ? notesById.get(sourceItem.noteId) : null;
		const target = targetItem ? notesById.get(targetItem.noteId) : null;
		if (!source || !target) return null;
		return { sourceTitle: source.title || 'Untitled', targetTitle: target.title || 'Untitled' };
	});
	let flowMode = $state(false);
	let flowFromItemId = $state<string | null>(null);
	let flowConnecting = $state(false);
	/** Sequence whose end-card menu stays open (invalid repair / click). */
	let pinnedFlowMenuSeqId = $state<string | null>(null);
	let hoveredFlowMenuSeqId = $state<string | null>(null);
	let flowMenuLeaveTimer: ReturnType<typeof setTimeout> | null = null;

	function clearFlowMenuLeaveTimer() {
		if (flowMenuLeaveTimer) {
			clearTimeout(flowMenuLeaveTimer);
			flowMenuLeaveTimer = null;
		}
	}

	function setHoveredFlowMenu(seqId: string | null) {
		clearFlowMenuLeaveTimer();
		if (seqId) {
			hoveredFlowMenuSeqId = seqId;
			return;
		}
		// Brief delay so the pointer can cross the card → menu gap.
		flowMenuLeaveTimer = setTimeout(() => {
			hoveredFlowMenuSeqId = null;
			flowMenuLeaveTimer = null;
		}, 180);
	}

	let flowBoard = $derived(listFlowSequences(items, edges));
	let flowBadges = $derived(flowPageBadges(flowBoard.sequences));
	let invalidEdgeIds = $derived(invalidSequenceEdgeIds(flowBoard.sequences, edges));
	let primaryFocusNoteId = $derived(
		primarySelectedId && selectedIds.has(primarySelectedId)
			? primarySelectedId
			: ([...selectedIds][0] ?? null)
	);
	let invalidExportToastShown = $state(false);
	let lastAutoExpandedInvalidKey = $state('');
	let flowEndMenus = $derived.by(() => {
		return flowBoard.sequences
			.map((seq, si) => {
				const last = seq.pages[seq.pages.length - 1];
				if (!last) return null;
				const size = cardSize(last, last.noteId);
				return {
					seq,
					si,
					itemId: last.id,
					// Sit just past the last card’s right edge (trigger stays hittable).
					x: last.x + size.w + 4,
					y: last.y + Math.max(0, (size.h - 28) / 2)
				};
			})
			.filter((m): m is NonNullable<typeof m> => Boolean(m));
	});
	let flowEndItemToSeqId = $derived(new Map(flowEndMenus.map((m) => [m.itemId, m.seq.id])));
	$effect(() => {
		const invalidKeys = flowBoard.sequences
			.map((s, i) => (s.invalid ? `${i}:${s.id}` : null))
			.filter((k): k is string => Boolean(k));
		const key = invalidKeys.join('|');
		if (!key) {
			lastAutoExpandedInvalidKey = '';
			invalidExportToastShown = false;
			if (pinnedFlowMenuSeqId && !flowBoard.sequences.some((s) => s.id === pinnedFlowMenuSeqId)) {
				pinnedFlowMenuSeqId = null;
			}
			return;
		}
		if (key === lastAutoExpandedInvalidKey) return;
		lastAutoExpandedInvalidKey = key;
		const firstInvalid = flowBoard.sequences.find((s) => s.invalid);
		if (firstInvalid) pinnedFlowMenuSeqId = firstInvalid.id;
	});
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
		flowConnecting = false;
	}

	function toggleFlowMode() {
		if (flowMode) {
			exitFlowMode();
			return;
		}
		onClearSelection?.();
		flowMode = true;
		flowFromItemId = null;
		if (edges.length > 0) {
			void (async () => {
				const moved = await onRelayoutFlow?.();
				if (moved) onToast?.('Sequences packed in order');
			})();
		}
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
			const { exportSequencePdf: downloadSequencePdf } = await import('$lib/sequence-pdf');
			const ok = await downloadSequencePdf(payload.notes, payload.title);
			if (!ok) {
				console.error('Export PDF failed');
				onToast?.('Could not export PDF');
				return;
			}
			onToast?.('PDF downloaded');
			exitFlowMode();
		} catch (e) {
			console.error(e);
			onToast?.('Could not export PDF');
		}
	}

	function printSequence(seqIndex = 0) {
		const idx = resolveExportSeqIndex(seqIndex);
		if (idx < 0) return;
		const payload = notesForSequence(idx);
		if (!payload) return;
		try {
			printSequenceAsPdf(payload.notes, payload.title);
			exitFlowMode();
		} catch (e) {
			console.error(e);
			onToast?.('Could not open print preview');
		}
	}

	async function copySequenceOutline(seqIndex?: number) {
		const seqs =
			seqIndex === undefined
				? flowBoard.sequences
				: flowBoard.sequences[seqIndex]
					? [flowBoard.sequences[seqIndex]!]
					: [];
		if (seqs.length === 0) return;
		const md = flowOutlineMarkdown(seqs, notesById);
		try {
			await navigator.clipboard.writeText(md);
			onToast?.('Outline copied');
		} catch {
			onToast?.('Could not copy outline');
		}
	}

	let canExportAnySequence = $derived(
		flowBoard.sequences.some((s) => !s.invalid && s.pages.length > 0)
	);

	$effect(() => {
		if (canExportAnySequence || edges.length === 0) {
			invalidExportToastShown = false;
			return;
		}
		const hasInvalid = flowBoard.sequences.some((s) => s.invalid);
		if (!hasInvalid || invalidExportToastShown) return;
		invalidExportToastShown = true;
		onToast?.('Fix or Unstitch broken sequences to export');
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

	function maybeSnapSize(w: number, h: number, expanded: boolean): { w: number; h: number } {
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
		const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
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
		if (desktopViewOpen) desktopViewOpen = false;
		if (target.closest('[data-flow-edge]')) return;

		if (flowFromItemId) {
			flowFromItemId = null;
			pinnedFlowMenuSeqId = null;
			onBlankPointerDown?.();
			return;
		}

		pinnedFlowMenuSeqId = null;
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
			const screenDx = e.clientX - resizeOrigin.x;
			const screenDy = e.clientY - resizeOrigin.y;
			if (!didDrag && Math.hypot(screenDx, screenDy) < POINTER_DRAG_THRESHOLD) return;
			didDrag = true;
			const dx = screenDx / scale;
			const dy = screenDy / scale;
			const bounds = resizeOrigin.expanded ? EXPANDED_BOUNDS : COLLAPSED_BOUNDS;
			const next = clampSize(resizeOrigin.w + dx, resizeOrigin.h + dy, bounds);
			onResize(resizeItemId, next.w, next.h);
			return;
		}
		if (dragItemId) {
			const screenDx = e.clientX - dragOrigin.x;
			const screenDy = e.clientY - dragOrigin.y;
			if (!didDrag && Math.hypot(screenDx, screenDy) < POINTER_DRAG_THRESHOLD) return;
			if (!didDrag) {
				didDrag = true;
				// Selection follows direct manipulation as soon as this becomes a
				// real drag. A plain click still resolves on pointer-up.
				if (dragSelectionIntent && !dragSelectionIntent.initiallySelected) {
					onSelect(dragSelectionIntent.noteId, {
						additive: dragSelectionIntent.additive,
						range: false
					});
				}
			}
			const dx = screenDx / scale;
			const dy = screenDy / scale;
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
					const rect = dragStageRect;
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
		if (w * scale < POINTER_DRAG_THRESHOLD && h * scale < POINTER_DRAG_THRESHOLD) {
			if (!marqueeAdditive) onSelectNotes([], { additive: false });
			return;
		}
		const hit: string[] = [];
		for (const item of items) {
			const size = cardSize(item, item.noteId);
			// Rect intersection (not center-only) so partially boxed cards count.
			const overlaps = item.x < x2 && item.x + size.w > x1 && item.y < y2 && item.y + size.h > y1;
			if (overlaps) hit.push(item.noteId);
		}
		onSelectNotes(hit, { additive: marqueeAdditive });
		if (hit.length > 0 && !pendingMash && !expandedNoteId) {
			const focusId = hit[0]!;
			requestAnimationFrame(() => {
				const el = boardEl?.querySelector<HTMLElement>(
					`[data-canvas-card][data-note-id="${CSS.escape(focusId)}"]`
				);
				el?.focus({ preventScroll: true });
			});
		}
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
		dragSelectionIntent = null;
		dragStageRect = null;
		if (!sourceId || !didDrag) {
			onStageSnapPreview?.(null);
			return;
		}

		// Edge snap → open in editor stage (single-card drag only).
		if (group.length <= 1 && boardEl && onOpenInStage) {
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

		// Snap mode: land dragged cards on the lattice only — leave stationary
		// neighbors where they are (Organize is the explicit tidy action).
		if (snapEffective && !willMash) {
			const changed = moves.filter((m) => {
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

				const movedIds = new Set(changed.map((m) => m.itemId));
				const overlapsNeighbor = changed.some((m) => {
					const moved = items.find((i) => i.id === m.itemId);
					if (!moved) return false;
					const ms = cardSize(moved, moved.noteId);
					for (const other of items) {
						if (movedIds.has(other.id)) continue;
						const os = cardSize(other, other.noteId);
						const overlaps = !(
							m.x + ms.w <= other.x ||
							other.x + os.w <= m.x ||
							m.y + ms.h <= other.y ||
							other.y + os.h <= m.y
						);
						if (overlaps) return true;
					}
					return false;
				});
				if (overlapsNeighbor) {
					onToast?.('Overlapping — Organize to tidy');
				}
			}
			return;
		}

		if (snapEffective) {
			onMoveMany(moves);
		}
		const before = group.map((g) => ({ itemId: g.id, x: g.originX, y: g.originY }));
		// Immediate mash prunes undo entries for removed cards — don't leave a
		// stale move entry for the source. First-time confirm keeps the move so
		// Cancel → Undo can restore.
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

	/** Pointer cancellation should never commit a half-finished gesture. */
	function cancelBoardGesture(e: PointerEvent) {
		isPanning = false;
		marquee = null;
		if (moveRaf) {
			cancelAnimationFrame(moveRaf);
			moveRaf = 0;
		}
		pendingMoves = null;
		if (resizeItemId) {
			onResize(resizeItemId, resizeOrigin.w, resizeOrigin.h);
			resizeItemId = null;
		}
		if (dragItemId && dragGroup.length > 0) {
			onMoveMany(dragGroup.map((g) => ({ itemId: g.id, x: g.originX, y: g.originY })));
		}
		dragItemId = null;
		dragGroup = [];
		dragSelectionIntent = null;
		dragStageRect = null;
		mashTargetId = null;
		pendingEdgeZone = null;
		didDrag = false;
		onStageSnapPreview?.(null);
		try {
			boardEl?.releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
	}

	function panBy(dx: number, dy: number) {
		panX += dx;
		panY += dy;
	}

	function zoomAround(localX: number, localY: number, requestedScale: number) {
		const before = scale;
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale));
		if (Math.abs(next - before) < 0.0005) return;
		panX = localX - ((localX - panX) * next) / before;
		panY = localY - ((localY - panY) * next) / before;
		scale = next;
	}

	function zoomFromCenter(factor: number) {
		if (!boardEl) return;
		const x = (boardWidth || boardEl.clientWidth) / 2;
		const y = (boardHeight || boardEl.clientHeight) / 2;
		zoomAround(x, y, scale * factor);
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

		// ⌘/Ctrl + scroll / trackpad pinch → zoom toward cursor
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const rect = boardEl.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			// Normalize wheel units, then apply a soft exponential step.
			// Trackpad pinch sends many small pixel deltas; mouse wheels send larger line/page ticks.
			const raw =
				e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
			const ZOOM_SENSITIVITY = 0.0018;
			const factor = Math.exp(-raw * ZOOM_SENSITIVITY);
			zoomAround(mx, my, scale * factor);
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
			if (flowConnecting) return;
			if (!flowFromItemId) {
				flowFromItemId = item.id;
			} else if (flowFromItemId === item.id) {
				flowFromItemId = null;
			} else {
				const from = flowFromItemId;
				flowConnecting = true;
				void (async () => {
					try {
						const ok = await onConnectFlow?.(from, item.id);
						// Keep chaining from the new last page; on failure keep the source.
						if (flowMode && ok === true) flowFromItemId = item.id;
					} finally {
						flowConnecting = false;
					}
				})();
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
		const additive = e.metaKey || e.ctrlKey;
		dragSelectionIntent = {
			noteId: item.noteId,
			additive,
			initiallySelected: noteSelected
		};
		if (noteSelected && selectedIds.size > 1) {
			dragGroup = items
				.filter((i) => selectedIds.has(i.noteId))
				.map((i) => ({ id: i.id, originX: i.x, originY: i.y }));
		} else if (!noteSelected && additive && selectedIds.size > 0) {
			// Command/Ctrl-drag adds the grabbed card and moves the resulting group.
			dragGroup = items
				.filter((i) => selectedIds.has(i.noteId) || i.noteId === item.noteId)
				.map((i) => ({ id: i.id, originX: i.x, originY: i.y }));
		} else {
			dragGroup = [{ id: item.id, originX: item.x, originY: item.y }];
		}
		dragStageRect = dragGroup.length <= 1 ? stageSnapRect() : null;

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
			if (!pendingMash && !expandedNoteId) {
				requestAnimationFrame(() => {
					const el = boardEl?.querySelector<HTMLElement>(
						`[data-canvas-card][data-note-id="${CSS.escape(item.noteId)}"]`
					);
					el?.focus({ preventScroll: true });
				});
			}
		}
		if (dragItemId) finishDrag();
	}

	function startResize(e: PointerEvent, item: CanvasItem) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		didDrag = false;
		pendingMash = null;
		if (!selectedIds.has(item.noteId)) {
			onSelect(item.noteId, { additive: false, range: false });
		}
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
		const hasFiles = e.dataTransfer?.types.includes('Files') ?? false;
		if (
			!hasFiles &&
			!e.dataTransfer?.types.includes(NOTE_MIME) &&
			!e.dataTransfer?.types.includes('text/plain')
		) {
			return;
		}
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		isExternalDragOver = true;
		isFileDragOver = hasFiles;
	}

	function handleDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (related && boardEl?.contains(related)) return;
		isExternalDragOver = false;
		isFileDragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		isExternalDragOver = false;
		isFileDragOver = false;
		const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
		if (droppedFiles.length > 0) {
			let pos = clientToBoard(e.clientX, e.clientY);
			pos = maybeSnapPos(pos.x, pos.y);
			void onDropFiles?.(droppedFiles, pos.x, pos.y);
			return;
		}
		const raw = e.dataTransfer?.getData(NOTE_MIME) || e.dataTransfer?.getData('text/plain') || '';
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

	function zoomToFit(selectionOnly = false, minScale = MIN_SCALE) {
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
			56,
			{ min: minScale, max: MAX_SCALE }
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
		onMoveEnd?.(
			changed,
			before.filter((b) => changed.some((c) => c.itemId === b.itemId))
		);
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
		const el = boardEl;
		if (!el) return;
		const updateSize = () => {
			const rect = el.getBoundingClientRect();
			boardWidth = rect.width;
			boardHeight = rect.height;
		};
		updateSize();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(updateSize);
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const media = window.matchMedia('(max-width: 720px)');
		let previous = media.matches;
		isMobileViewport = previous;
		if (previous) mobileViewportEntry = ++mobileViewportEntrySeed;
		const onChange = () => {
			const next = media.matches;
			if (next && !previous) mobileViewportEntry = ++mobileViewportEntrySeed;
			previous = next;
			isMobileViewport = next;
			if (!next) mobileToolsOpen = false;
		};
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
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
		if (!Number.isFinite(panX + panY + scale)) return;
		if (!canvasId || appliedCanvasId !== canvasId) return;
		scheduleViewportSave();
	});

	$effect(() => {
		const key = mobileAutoFitKey({
			isMobile: isMobileViewport,
			canvasId,
			itemCount: items.length,
			boardWidth,
			boardHeight,
			entry: mobileViewportEntry,
			lastAppliedKey: lastMobileAutoFitKey
		});
		if (!key) return;
		lastMobileAutoFitKey = key;
		requestAnimationFrame(() => {
			if (isMobileViewport && key === lastMobileAutoFitKey) zoomToFit(false, 0.55);
		});
	});

	/** Desktop: if a restored viewport left every card off-screen, fit once. */
	$effect(() => {
		if (isMobileViewport || !canvasId || !boardEl || boardWidth <= 0 || boardHeight <= 0) return;
		if (appliedCanvasId !== canvasId) return;
		const present = items.filter((item) => notesById.has(item.noteId));
		if (present.length === 0) return;
		const pad = 24;
		const left = (-panX - pad) / scale;
		const top = (-panY - pad) / scale;
		const right = (-panX + boardWidth + pad) / scale;
		const bottom = (-panY + boardHeight + pad) / scale;
		const anyInView = present.some((item) => {
			const size = cardSize(item, item.noteId);
			return item.x < right && item.x + size.w > left && item.y < bottom && item.y + size.h > top;
		});
		if (anyInView) return;
		const key = `${canvasId}:${present.map((i) => i.id).join(',')}`;
		if (key === lastOffscreenFitKey) return;
		lastOffscreenFitKey = key;
		requestAnimationFrame(() => {
			if (lastOffscreenFitKey === key) zoomToFit(false);
		});
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
		function onConfirmKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopImmediatePropagation();
				cancelPendingMash();
				return;
			}
		}
		window.addEventListener('keydown', onConfirmKey, true);
		return () => window.removeEventListener('keydown', onConfirmKey, true);
	});

	$effect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Alt') altHeld = true;
			const eventTarget = e.target instanceof HTMLElement ? e.target : null;
			// Modal controls own their keyboard events. Canvas shortcuts must never
			// open cards, nudge selections, or consume radio/button activation behind them.
			if (eventTarget?.closest('[aria-modal="true"]')) return;
			if (e.key === 'Escape' && mobileToolsOpen) {
				mobileToolsOpen = false;
				return;
			}
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
			if (
				(e.metaKey || e.ctrlKey) &&
				e.key.toLowerCase() === 'a' &&
				pointerOverBoard &&
				items.length > 0
			) {
				e.preventDefault();
				toggleSelectAllOnBoard();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key === '1' && pointerOverBoard) {
				e.preventDefault();
				zoomToFit(false);
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key === '0' && pointerOverBoard) {
				e.preventDefault();
				resetView();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+') && pointerOverBoard) {
				e.preventDefault();
				zoomFromCenter(ZOOM_BUTTON_FACTOR);
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key === '-' && pointerOverBoard) {
				e.preventDefault();
				zoomFromCenter(1 / ZOOM_BUTTON_FACTOR);
				return;
			}
			if (selectedIds.size === 0) return;
			if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
				const active = e.target as HTMLElement | null;
				if (active?.isContentEditable) return;
				const onCard = active?.closest?.('[data-canvas-card]');
				const noteId =
					onCard?.getAttribute('data-note-id') ?? primaryFocusNoteId ?? [...selectedIds][0] ?? null;
				if (!noteId || flowMode) return;
				e.preventDefault();
				if (onOpenInStage) onOpenInStage(noteId, 'maximize');
				else onExpand(noteId);
				return;
			}
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

	let boardNoteIds = $derived([...new Set(items.map((i) => i.noteId))]);
	let allBoardNotesSelected = $derived(
		boardNoteIds.length > 0 && boardNoteIds.every((id) => selectedIds.has(id))
	);

	function toggleSelectAllOnBoard() {
		if (boardNoteIds.length === 0) return;
		if (allBoardNotesSelected) onSelectNotes([], { additive: false });
		else onSelectNotes(boardNoteIds, { additive: false });
	}

	/** Cull cards far outside the viewport (keep a generous pad for smooth pan). */
	let visibleItemIds = $derived.by(() => {
		if (!boardEl || boardWidth <= 0 || boardHeight <= 0 || items.length < 40) {
			return new SvelteSet(items.map((i) => i.id));
		}
		const pad = 280;
		const left = (-panX - pad) / scale;
		const top = (-panY - pad) / scale;
		const right = (-panX + boardWidth + pad) / scale;
		const bottom = (-panY + boardHeight + pad) / scale;
		const ids = new SvelteSet<string>();
		for (const item of items) {
			const size = cardSize(item, item.noteId);
			const keep =
				item.x < right && item.x + size.w > left && item.y < bottom && item.y + size.h > top;
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
	onpointercancel={cancelBoardGesture}
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
				{@const provenanceTitles = (note.mashedFrom ?? [])
					.map((id) => notesById.get(id)?.title)
					.filter((title): title is string => Boolean(title))}
				{@const isPermanentWelcome = isPermanentMashWelcomeNote(note)}
				{@const links = linkSummaries.get(note.id)!}
				{@const pageBadge = flowBadges.get(item.id)}
				{@const isPrimaryFocus = primaryFocusNoteId === note.id}
				{@const endSeqId = flowEndItemToSeqId.get(item.id)}
				<!-- Canvas cards are focus-managed composite widgets inside the application surface. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					data-canvas-card
					data-note-id={note.id}
					data-system-welcome={isPermanentWelcome ? 'true' : undefined}
					role="group"
					aria-label={`${note.title || 'Untitled'}${selected ? ', selected' : ''}`}
					aria-roledescription="canvas card"
					tabindex={isPrimaryFocus ? 0 : -1}
					data-expanded={expanded ? 'true' : undefined}
					class="mash-note-card absolute flex flex-col rounded-xl {selected
						? 'is-selected'
						: ''} {settling ? 'is-settling' : ''} {expanded ? 'is-expanded' : ''} {isDragging
						? 'is-dragging-card'
						: ''} {isMashTarget || isPendingPartner ? 'is-mash-target' : ''} {isPendingSource
						? 'is-mash-confirming'
						: ''} {isMash ? 'is-mash-result' : ''} {flowFromItemId === item.id
						? 'is-flow-source'
						: ''} {flowMode ? 'is-flow-mode' : ''}"
					style="left: {item.x}px; top: {item.y}px; width: {size.w}px; height: {size.h}px;"
					onpointerdown={(e) => startCardDrag(e, item)}
					onpointerup={(e) => endCardDrag(e, item)}
					onpointerenter={() => {
						if (endSeqId) setHoveredFlowMenu(endSeqId);
					}}
					onpointerleave={() => {
						if (endSeqId) setHoveredFlowMenu(null);
					}}
					onkeydown={(e) => {
						if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
						if (flowMode || expanded) return;
						const t = e.target as HTMLElement;
						if (t !== e.currentTarget && t.closest('button, input, textarea, [contenteditable]'))
							return;
						e.preventDefault();
						e.stopPropagation();
						if (onOpenInStage) onOpenInStage(note.id, 'maximize');
						else onExpand(note.id);
					}}
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
							use:focusTrap={{ initialFocus: '[data-dialog-initial-focus]' }}
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
								{pendingMashCopy
									? `Mash “${pendingMashCopy.sourceTitle}” with “${pendingMashCopy.targetTitle}”?`
									: 'Mash these notes?'}
							</p>
							<p
								class="max-w-[16rem] text-center text-[10px] leading-snug text-[var(--mash-ink-muted)]"
							>
								One combined sticky replaces both cards. Unmash restores the originals.
							</p>
							<div class="flex items-center gap-2">
								<button
									data-dialog-initial-focus
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
							class="mash-card-header flex cursor-grab items-center gap-1 border-b border-[var(--mash-card-edge)] px-2.5 py-1.5 active:cursor-grabbing"
						>
							<input
								bind:this={titleInputEl}
								type="text"
								value={note.title}
								readonly={isPermanentWelcome}
								class="mash-focus min-w-0 flex-1 bg-transparent text-sm font-semibold tracking-tight outline-none"
								style="color: var(--mash-card-ink);"
								onpointerdown={(e) => e.stopPropagation()}
								oninput={(e) => onTitleChange(note.id, (e.currentTarget as HTMLInputElement).value)}
							/>
							{#if !isPermanentWelcome}
								<button
									type="button"
									class="shrink-0 rounded p-1 text-[var(--mash-card-muted)] hover:bg-[var(--mash-card-hover)] {note.pinned ===
									1
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
							{/if}
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
							class="mash-card-meta flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--mash-card-edge)] px-2.5 py-1"
							data-no-drag
							role="group"
							aria-label="Note metadata"
							onpointerdown={(e) => e.stopPropagation()}
						>
							<FolderSuggestField
								value={note.folder}
								{folders}
								onChange={(folder) => onMetaChange?.(note.id, { folder })}
							/>
							<TagSuggestField
								class="min-w-[40%]"
								value={note.tags}
								{tags}
								placeholder="tags, comma, separated"
								onChange={(nextTags) => onMetaChange?.(note.id, { tags: nextTags })}
							/>
							{#if links.outgoingCount + links.backlinkCount > 0}
								<button
									type="button"
									class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-[var(--mash-card-muted)] tabular-nums hover:bg-[var(--mash-card-hover)] hover:text-[var(--mash-accent)]"
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
								readOnly={isPermanentWelcome}
								heroImage={isPermanentWelcome
									? { src: MASH_SPOON_LOGO, alt: 'Scoop, the Mash mascot' }
									: null}
								textAlign={note.textAlign}
								autofocus={expandFocus !== 'title'}
								onBodyChange={(b) => onBodyChange(note.id, b)}
								onTextAlignChange={(align) => onMetaChange?.(note.id, { textAlign: align })}
								onWikilink={(target) => onWikilink?.(target)}
							/>
						</div>
					{:else}
						<div
							class="mash-card-title-row flex items-start justify-between gap-1.5 border-b border-[var(--mash-card-edge)] px-2.5 py-2"
						>
							<span
								class="flex min-w-0 items-center gap-1 truncate text-xs font-semibold tracking-tight"
							>
								{#if note.pinned === 1}
									<Pin class="h-3 w-3 shrink-0 text-[var(--mash-accent)]" />
								{/if}
								{#if isMash}<span class="mr-0.5 text-[var(--mash-accent)]">◎</span>{/if}
								<span class="truncate">{note.title}</span>
								{#if note.scope === 'kept' && !isPermanentWelcome}
									<span
										class="mash-card-scope shrink-0 rounded px-1 py-px text-[8px] font-semibold tracking-wide uppercase"
										style="background: color-mix(in srgb, var(--mash-accent) 16%, transparent); color: var(--mash-accent);"
										title="Kept on this device"
										>Kept</span
									>
								{:else if note.scope === 'session' && !isPermanentWelcome}
									<span
										class="mash-card-scope shrink-0 rounded px-1 py-px text-[8px] font-semibold tracking-wide uppercase"
										style="background: color-mix(in srgb, var(--mash-card-muted) 18%, transparent); color: var(--mash-card-muted);"
										title="Scratch desk ingredient — clear with the desk unless you Keep"
										>Desk</span
									>
								{/if}
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
							class="mash-card-preview min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2.5 text-[11px] leading-snug text-[var(--mash-card-muted)]"
							style="text-align: {note.textAlign === 'center' || note.textAlign === 'right'
								? note.textAlign
								: 'left'};"
						>
							{#if isPermanentWelcome}
								<div class="flex items-center gap-2">
									<img
										src={MASH_SPOON_LOGO}
										alt="Scoop, the Mash mascot"
										class="h-14 w-14 shrink-0 object-contain drop-shadow-sm"
									/>
									<span class="line-clamp-4">{notePreview(note.body, 140)}</span>
								</div>
							{:else}
								{@const cardImage = parseEmbeddedNoteImage(note.body)}
								{#if cardImage}
									<div class="flex flex-col gap-1.5">
										<img
											src={cardImage.src}
											alt={cardImage.alt || note.title}
											class="max-h-36 w-full rounded-md object-contain"
											style="background: color-mix(in srgb, var(--mash-card-hover) 70%, transparent);"
										/>
										{#if cardImage.caption.trim()}
											<span class="line-clamp-2">{notePreview(cardImage.caption, 72)}</span>
										{/if}
									</div>
								{:else}
									{notePreview(note.body, 220)}
								{/if}
							{/if}
							{#if note.source?.kind === 'pdf'}
								<div
									class="mash-card-source mt-2 flex items-center gap-1 border-t pt-1.5 text-[9px]"
									style="border-color: var(--mash-card-edge); color: var(--mash-accent);"
									title="Captured from {note.source.title}, page {note.source.page}"
								>
									<FileText class="h-2.5 w-2.5 shrink-0" />
									<span class="truncate">{note.source.title} · p. {note.source.page}</span>
								</div>
							{:else if note.source?.kind === 'docx'}
								<div
									class="mash-card-source mt-2 flex items-center gap-1 border-t pt-1.5 text-[9px]"
									style="border-color: var(--mash-card-edge); color: var(--mash-accent);"
									title="Captured from {note.source.title}"
								>
									<FileText class="h-2.5 w-2.5 shrink-0" />
									<span class="truncate">{note.source.title}</span>
								</div>
							{:else if note.source?.kind === 'image'}
								<div
									class="mash-card-source mt-2 flex items-center gap-1 border-t pt-1.5 text-[9px]"
									style="border-color: var(--mash-card-edge); color: var(--mash-accent);"
									title="Image: {note.source.title}"
								>
									<FileText class="h-2.5 w-2.5 shrink-0" />
									<span class="truncate">{note.source.title}</span>
								</div>
							{:else if note.source?.kind === 'url'}
								<div
									class="mash-card-source mt-2 flex items-center gap-1 border-t pt-1.5 text-[9px]"
									style="border-color: var(--mash-card-edge); color: var(--mash-accent);"
									title={note.source.url}
								>
									<FileText class="h-2.5 w-2.5 shrink-0" />
									<span class="truncate">{note.source.title}</span>
								</div>
							{:else if note.source?.kind === 'html'}
								<div
									class="mash-card-source mt-2 flex items-center gap-1 border-t pt-1.5 text-[9px]"
									style="border-color: var(--mash-card-edge); color: var(--mash-accent);"
									title="Captured from {note.source.title}"
								>
									<FileText class="h-2.5 w-2.5 shrink-0" />
									<span class="truncate">{note.source.title}</span>
								</div>
							{/if}
							{#if note.mashedFrom?.length}
								<div
									class="mash-card-provenance mt-2 border-t pt-1.5 text-[9px]"
									style="border-color: var(--mash-card-edge); color: var(--mash-accent);"
									title={provenanceTitles.length > 0
										? `Made from: ${provenanceTitles.join(', ')}`
										: `Made from ${note.mashedFrom.length} source cards`}
								>
									Made from {note.mashedFrom.length} source{note.mashedFrom.length === 1 ? '' : 's'}
								</div>
							{/if}
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
					<marker
						id="mash-flow-arrow-warn"
						markerWidth="8"
						markerHeight="8"
						refX="6"
						refY="3"
						orient="auto"
						markerUnits="strokeWidth"
					>
						<path d="M0,0 L6,3 L0,6 Z" fill="var(--mash-danger)" />
					</marker>
				</defs>
				{#each flowPaths as path (path.id)}
					<path
						d={path.d}
						fill="none"
						stroke={invalidEdgeIds.has(path.id) ? 'var(--mash-danger)' : 'var(--mash-accent)'}
						stroke-width={invalidEdgeIds.has(path.id) ? '2.75' : '2'}
						stroke-linecap="round"
						marker-end={invalidEdgeIds.has(path.id)
							? 'url(#mash-flow-arrow-warn)'
							: 'url(#mash-flow-arrow)'}
						opacity="0.9"
					/>
				{/each}
			</svg>
			{#each flowPaths as path (path.id)}
				<button
					type="button"
					data-flow-edge
					class="mash-flow-edge-hit absolute z-[4] -translate-x-1/2 -translate-y-1/2 rounded-full border bg-[var(--mash-card)] text-[10px] font-bold shadow {invalidEdgeIds.has(
						path.id
					)
						? 'is-invalid border-[var(--mash-danger)] text-[var(--mash-danger)]'
						: 'border-[var(--mash-accent)] text-[var(--mash-accent)]'}"
					style="left: {path.midX}px; top: {path.midY}px; width: 18px; height: 18px;"
					title={invalidEdgeIds.has(path.id)
						? 'Broken sequence link — remove to repair'
						: 'Remove flow link'}
					aria-label={invalidEdgeIds.has(path.id) ? 'Remove broken flow link' : 'Remove flow link'}
					onclick={(e) => {
						e.stopPropagation();
						void onDisconnectFlow?.(path.id);
					}}
				>
					×
				</button>
			{/each}
		{/if}

		{#each flowEndMenus as menu (menu.seq.id)}
			{@const open = pinnedFlowMenuSeqId === menu.seq.id || hoveredFlowMenuSeqId === menu.seq.id}
			<div
				data-canvas-chrome
				data-flow-end-menu
				class="mash-flow-end-menu absolute z-[6]"
				class:is-open={open}
				class:is-invalid={menu.seq.invalid}
				style="left: {menu.x}px; top: {menu.y}px;"
				role="group"
				aria-label={flowBoard.sequences.length > 1
					? `Sequence ${menu.si + 1} options`
					: 'Sequence options'}
				onpointerenter={() => {
					setHoveredFlowMenu(menu.seq.id);
				}}
				onpointerleave={() => {
					setHoveredFlowMenu(null);
				}}
			>
				<button
					type="button"
					class="mash-flow-end-menu-trigger"
					title={menu.seq.invalid ? 'Broken sequence — open options' : 'Sequence options'}
					aria-expanded={open}
					aria-haspopup="true"
					onclick={(e) => {
						e.stopPropagation();
						pinnedFlowMenuSeqId = pinnedFlowMenuSeqId === menu.seq.id ? null : menu.seq.id;
					}}
				>
					{flowBoard.sequences.length > 1 ? `S${menu.si + 1}` : 'Seq'}
					{#if menu.seq.invalid}<span class="warn">!</span>{/if}
				</button>
				{#if open}
					<div class="mash-flow-end-menu-panel">
						{#if flowMode}
							<button
								type="button"
								class="mash-board-chip-btn"
								onclick={(e) => {
									e.stopPropagation();
									exitFlowMode();
								}}
								title="Finish linking pages"
							>
								Done
							</button>
						{/if}
						<button
							type="button"
							class="mash-board-chip-btn"
							onclick={(e) => {
								e.stopPropagation();
								onSelectNotes(
									menu.seq.pages.map((p) => p.noteId),
									{ additive: false }
								);
							}}
							title="Select cards in this sequence"
						>
							Select
						</button>
						<button
							type="button"
							class="mash-board-chip-btn"
							onclick={(e) => {
								e.stopPropagation();
								void onUnstitchSequence?.(menu.si);
								pinnedFlowMenuSeqId = null;
							}}
							title="Remove all links in this sequence"
						>
							Unstitch
						</button>
						{#if !menu.seq.invalid}
							<button
								type="button"
								class="mash-board-chip-btn is-accent"
								onclick={(e) => {
									e.stopPropagation();
									void exportSequencePdf(menu.si);
								}}
								title="Download this sequence as PDF"
							>
								PDF
							</button>
							<button
								type="button"
								class="mash-board-chip-btn"
								onclick={(e) => {
									e.stopPropagation();
									printSequence(menu.si);
								}}
								title="Print this sequence"
							>
								Print
							</button>
							<button
								type="button"
								class="mash-board-chip-btn"
								onclick={(e) => {
									e.stopPropagation();
									void copySequenceOutline(menu.si);
								}}
								title="Copy page outline"
							>
								Copy
							</button>
						{:else}
							<span class="mash-flow-end-menu-hint">Fix links or Unstitch</span>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if emptyStateVisible}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6 sm:p-8">
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
				<p class="mash-display mash-empty-title mt-5 text-xl font-medium tracking-tight sm:text-[1.35rem]">
					{isFileDragOver
						? 'Drop files to import'
						: isExternalDragOver
							? 'Drop to place'
							: emptyMascot.title}
				</p>
				{#if isFileDragOver}
					<p class="mash-empty-copy mt-2 max-w-[18rem] text-sm leading-relaxed">
						PDF, Markdown, text, note JSON, or a Mash sync bundle
					</p>
				{:else if !isExternalDragOver}
					<p class="mash-empty-copy mt-2 max-w-[17rem] text-sm leading-relaxed">
						{emptyMascot.copy}
					</p>
				{/if}
			</div>
		</div>
	{:else if isExternalDragOver}
		<div
			class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-[var(--mash-accent)] bg-[var(--mash-accent-wash)] p-6"
		>
			{#if isFileDragOver}
				<div
					class="mash-drop-file-prompt flex flex-col items-center rounded-2xl border px-6 py-5 text-center shadow-lg"
				>
					<FileUp size={28} strokeWidth={1.8} aria-hidden="true" />
					<p class="mash-display mt-2 text-lg font-medium">Drop files to import</p>
					<p class="mt-1 text-xs">.pdf, .md, .markdown, .txt, or Mash .json</p>
				</div>
			{/if}
		</div>
	{/if}

	<div
		data-canvas-chrome
		class="mash-canvas-chrome-top pointer-events-none absolute top-3 right-3 z-10 flex flex-col items-end gap-1.5"
	>
		<div class="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
			<div class="mash-board-chip flex items-center rounded-full p-0.5 text-[10px]">
				<button
					type="button"
					class="mash-board-chip-btn rounded-full px-2.5 py-1 {!snapEnabled ? 'is-active' : ''}"
					onclick={(e) => {
						e.stopPropagation();
						if (snapEnabled) toggleSnap();
					}}
					title="Free placement — cards stay where you drop them"
				>
					Free
				</button>
				<button
					type="button"
					class="mash-board-chip-btn rounded-full px-2.5 py-1 {snapEnabled ? 'is-active' : ''}"
					onclick={(e) => {
						e.stopPropagation();
						if (!snapEnabled) toggleSnap();
					}}
					title="Snap drags to the grid (does not clear overlaps — use Organize in View). Alt flips temporarily"
				>
					Snap
				</button>
			</div>
			<button
				type="button"
				class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px] {flowMode
					? 'is-active'
					: ''}"
				onclick={(e) => {
					e.stopPropagation();
					desktopViewOpen = false;
					toggleFlowMode();
				}}
				title={flowMode
					? flowConnecting
						? 'Linking pages…'
						: 'Done — exit sequence mode'
					: 'Link pages in order: click last page, then next (keeps chaining)'}
				aria-pressed={flowMode}
				aria-busy={flowConnecting}
				data-testid="board-sequence"
			>
				{flowMode
					? flowConnecting
						? 'Linking…'
						: flowFromItemId
							? 'Pick next…'
							: 'Done'
					: 'Sequence'}
			</button>
			<button
				type="button"
				class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px]"
				onclick={(e) => {
					e.stopPropagation();
					zoomToFit(false);
				}}
				title="Fit all cards (⌘1)"
			>
				Fit
			</button>
			<button
				type="button"
				class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px] disabled:opacity-35"
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
				class="mash-board-chip mash-board-chip-btn rounded-full px-2.5 py-1 text-[10px] {desktopViewOpen
					? 'is-active'
					: ''}"
				onclick={(e) => {
					e.stopPropagation();
					desktopViewOpen = !desktopViewOpen;
				}}
				title="View and board tools"
				aria-label="View board tools"
				aria-haspopup="menu"
				aria-expanded={desktopViewOpen}
				data-testid="board-view-toggle"
			>
				View
			</button>
		</div>

		{#if desktopViewOpen}
			<div
				class="mash-board-view-menu pointer-events-auto grid w-52 grid-cols-1 gap-0.5 rounded-2xl border p-2 shadow-xl"
				style="border-color: var(--mash-panel-border); background: var(--mash-panel); backdrop-filter: blur(10px);"
				role="menu"
				aria-label="Board view tools"
				data-testid="board-view-menu"
			>
				<p
					class="px-2 pb-1 text-[9px] font-semibold tracking-wide uppercase"
					style="color: var(--mash-ink-muted);"
				>
					{Math.round(scale * 100)}%{altHeld ? ' · Alt' : ''}
				</p>
				<button
					type="button"
					role="menuitem"
					class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
					disabled={items.length === 0}
					onclick={(e) => {
						e.stopPropagation();
						organizeToSnap();
						desktopViewOpen = false;
					}}
				>
					Organize to grid
				</button>
				<button
					type="button"
					role="menuitem"
					class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
					disabled={items.length === 0}
					onclick={(e) => {
						e.stopPropagation();
						toggleSelectAllOnBoard();
						desktopViewOpen = false;
					}}
				>
					{allBoardNotesSelected ? 'Deselect all' : 'Select all'}
				</button>
				{#if selectedCount > 0}
					<button
						type="button"
						role="menuitem"
						class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
						onclick={(e) => {
							e.stopPropagation();
							zoomToFit(true);
							desktopViewOpen = false;
						}}
					>
						Fit selection
					</button>
				{/if}
				<button
					type="button"
					role="menuitem"
					class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px] disabled:opacity-35"
					disabled={!canRedo}
					onclick={(e) => {
						e.stopPropagation();
						onRedo?.();
						desktopViewOpen = false;
					}}
				>
					Redo layout
				</button>
				<button
					type="button"
					role="menuitem"
					class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
					onclick={(e) => {
						e.stopPropagation();
						resetView();
						desktopViewOpen = false;
					}}
				>
					Reset pan & zoom
				</button>
				{#if onOpenShortcuts}
					<button
						type="button"
						role="menuitem"
						class="mash-btn-ghost rounded-lg px-2.5 py-1.5 text-left text-[11px]"
						onclick={(e) => {
							e.stopPropagation();
							desktopViewOpen = false;
							onOpenShortcuts();
						}}
					>
						Keyboard shortcuts
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div
		data-canvas-chrome
		class="mash-canvas-chrome-mobile pointer-events-none absolute top-3 right-3 z-20"
	>
		<div class="mash-board-chip pointer-events-auto flex items-center gap-1 rounded-xl p-1 shadow">
			<button
				type="button"
				class="mash-mobile-chrome-btn"
				onclick={(e) => {
					e.stopPropagation();
					zoomToFit(false);
				}}
				disabled={items.length === 0}
			>
				Fit
			</button>
			<button
				type="button"
				class="mash-mobile-chrome-btn"
				onclick={(e) => {
					e.stopPropagation();
					organizeToSnap();
				}}
				disabled={items.length === 0}
			>
				Organize
			</button>
			<button
				type="button"
				class="mash-mobile-chrome-icon-btn"
				aria-label="More canvas tools"
				aria-haspopup="menu"
				aria-expanded={mobileToolsOpen}
				onclick={(e) => {
					e.stopPropagation();
					mobileToolsOpen = !mobileToolsOpen;
				}}
			>
				<MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" />
			</button>
		</div>

		{#if mobileToolsOpen}
			<div
				class="mash-mobile-tools-menu pointer-events-auto mt-2 grid grid-cols-2 gap-1 rounded-2xl p-2 shadow-xl"
			>
				<button
					type="button"
					class:active={!snapEnabled}
					onclick={() => {
						if (snapEnabled) toggleSnap();
						mobileToolsOpen = false;
					}}>Free placement</button
				>
				<button
					type="button"
					class:active={snapEnabled}
					onclick={() => {
						if (!snapEnabled) toggleSnap();
						mobileToolsOpen = false;
					}}>Snap to grid</button
				>
				<button
					type="button"
					disabled={items.length === 0}
					onclick={() => {
						toggleSelectAllOnBoard();
						mobileToolsOpen = false;
					}}>{allBoardNotesSelected ? 'Deselect all' : 'Select all'}</button
				>
				<button
					type="button"
					class:active={flowMode}
					onclick={() => {
						toggleFlowMode();
						mobileToolsOpen = false;
					}}>{flowMode ? 'End sequence' : 'Sequence'}</button
				>
				<button
					type="button"
					disabled={!canUndo}
					onclick={() => {
						onUndo?.();
						mobileToolsOpen = false;
					}}>Undo</button
				>
				<button
					type="button"
					disabled={!canRedo}
					onclick={() => {
						onRedo?.();
						mobileToolsOpen = false;
					}}>Redo</button
				>
				<button
					type="button"
					onclick={() => {
						resetView();
						mobileToolsOpen = false;
					}}>Reset view</button
				>
				{#if onOpenShortcuts}
					<button
						type="button"
						onclick={() => {
							onOpenShortcuts();
							mobileToolsOpen = false;
						}}>Shortcuts</button
					>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Pan / zoom pad -->
	<div
		data-canvas-chrome
		class="mash-canvas-chrome-pan pointer-events-auto absolute right-3 bottom-3 z-10 flex flex-col items-center gap-1"
	>
		<div class="mash-board-chip grid grid-cols-3 gap-0.5 rounded-lg p-1 shadow">
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
		<div class="mash-board-chip flex items-center gap-0.5 rounded-lg p-1 shadow">
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Zoom out"
				onclick={(e) => {
					e.stopPropagation();
					zoomFromCenter(1 / ZOOM_BUTTON_FACTOR);
				}}
			>
				−
			</button>
			<span
				class="min-w-[2.5rem] text-center text-[10px] text-[var(--mash-chrome-muted)] tabular-nums"
			>
				{Math.round(scale * 100)}%
			</span>
			<button
				type="button"
				class="mash-pan-btn"
				aria-label="Zoom in"
				onclick={(e) => {
					e.stopPropagation();
					zoomFromCenter(ZOOM_BUTTON_FACTOR);
				}}
			>
				+
			</button>
		</div>
		<p
			class="mash-chrome-hint max-w-[10rem] text-center text-[9px] leading-tight text-[var(--mash-chrome-muted)]"
		>
			{#if flowMode}
				Click last page → next · keeps chaining · Unstitch clears links · Export PDF downloads a
				file
			{:else}
				Drag to select · Edge = half editor · Drop into empty half to split · ⌘/Ctrl+scroll zoom
			{/if}
		</p>
	</div>
</div>
