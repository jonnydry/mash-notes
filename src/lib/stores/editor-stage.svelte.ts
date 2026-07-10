/* eslint-disable svelte/prefer-svelte-reactivity -- layoutOf uses a temporary membership set and never exposes it as reactive state. */
/**
 * Editor stage — screen-space note panes over the canvas (OS-like window snap).
 * Independent of canvas pan/zoom; cards stay on the board underneath.
 *
 * Side snaps stay half-width with an empty opposite half so a second note
 * can drop in (browser/macOS split style). Maximize is the only full-bleed.
 */
export type SnapZone = 'left' | 'right' | 'top' | 'bottom' | 'maximize';

export type PaneSlot = 'full' | 'left' | 'right' | 'top' | 'bottom';

export type EditorPane = {
	id: string;
	noteId: string;
	slot: PaneSlot;
};

export type StageLayout = 'empty' | 'single' | 'split-h' | 'split-v' | 'waiting-h' | 'waiting-v';

const EDGE_PX = 56;
const CORNER_IGNORE = 72;

export function newPaneId(): string {
	return crypto.randomUUID();
}

/** Detect snap zone from pointer position inside a stage rect. */
export function detectSnapZone(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number }
): SnapZone | null {
	const x = clientX - rect.left;
	const y = clientY - rect.top;
	const { width: w, height: h } = rect;
	if (w <= 0 || h <= 0) return null;
	if (x < 0 || y < 0 || x > w || y > h) return null;

	const nearLeft = x <= EDGE_PX;
	const nearRight = x >= w - EDGE_PX;
	const nearTop = y <= EDGE_PX;
	const nearBottom = y >= h - EDGE_PX;

	// Corners: prefer maximize only from top-center band, not corners.
	if (nearTop && x > CORNER_IGNORE && x < w - CORNER_IGNORE) return 'maximize';
	if (nearLeft && !nearTop && !nearBottom) return 'left';
	if (nearRight && !nearTop && !nearBottom) return 'right';
	if (nearTop && nearLeft) return 'left';
	if (nearTop && nearRight) return 'right';
	if (nearBottom && nearLeft) return 'left';
	if (nearBottom && nearRight) return 'right';
	if (nearBottom) return 'bottom';
	return null;
}

export type SplitRatios = { h?: number; v?: number };

/** Matches `.mash-editor-stage` dock clearance (see layout.css). */
export const STAGE_DOCK_GUTTER_PX = 84; // 5.25rem at 16px root
export const STAGE_MOBILE_BOTTOM_GUTTER_PX = 88; // ~5.5rem

/**
 * Map a full board/viewport rect to the editor-stage content rect so edge
 * snap + empty-half hit testing line up with the dock-inset stage.
 */
export function stageContentRect(
	board: { left: number; top: number; width: number; height: number },
	opts: { mobile?: boolean; dockGutter?: number; bottomGutter?: number } = {}
): { left: number; top: number; width: number; height: number } {
	const mobile = opts.mobile ?? false;
	const dock = opts.dockGutter ?? STAGE_DOCK_GUTTER_PX;
	const bottom = opts.bottomGutter ?? STAGE_MOBILE_BOTTOM_GUTTER_PX;
	if (mobile) {
		const h = Math.max(0, board.height - bottom);
		return { left: board.left, top: board.top, width: board.width, height: h };
	}
	const w = Math.max(0, board.width - dock);
	return { left: board.left + dock, top: board.top, width: w, height: board.height };
}

/**
 * When a half-pane is waiting for a partner, the whole empty half is a drop
 * target (not just the thin edge strip). Uses live split ratios so a resized
 * divider still matches the visual empty region.
 */
export function detectFillOrSnapZone(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
	panes: EditorPane[],
	splits: SplitRatios = {}
): SnapZone | null {
	const empty = emptySlotOf(panes);
	const splitH = Math.min(0.8, Math.max(0.2, splits.h ?? 0.5));
	const splitV = Math.min(0.8, Math.max(0.2, splits.v ?? 0.5));
	if (empty) {
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const { width: w, height: h } = rect;
		if (x >= 0 && y >= 0 && x <= w && y <= h) {
			switch (empty) {
				case 'left':
					if (x < w * splitH) return 'left';
					break;
				case 'right':
					if (x >= w * splitH) return 'right';
					break;
				case 'top':
					if (y < h * splitV) return 'top';
					break;
				case 'bottom':
					if (y >= h * splitV) return 'bottom';
					break;
				case 'full':
					break;
				default: {
					const _exhaustive: never = empty;
					void _exhaustive;
				}
			}
		}
	}
	return detectSnapZone(clientX, clientY, rect);
}

export function layoutOf(panes: EditorPane[]): StageLayout {
	if (panes.length === 0) return 'empty';
	if (panes.length === 1) {
		const slot = panes[0]!.slot;
		if (slot === 'left' || slot === 'right') return 'waiting-h';
		if (slot === 'top' || slot === 'bottom') return 'waiting-v';
		return 'single';
	}
	const slots = new Set(panes.map((p) => p.slot));
	if (slots.has('left') || slots.has('right')) return 'split-h';
	if (slots.has('top') || slots.has('bottom')) return 'split-v';
	return 'single';
}

/** Opposite half still empty (waiting for a second note). */
export function emptySlotOf(panes: EditorPane[]): PaneSlot | null {
	if (panes.length !== 1) return null;
	return oppositeSlot(panes[0]!.slot);
}

export function zoneToSlot(zone: SnapZone): PaneSlot {
	switch (zone) {
		case 'left':
			return 'left';
		case 'right':
			return 'right';
		case 'top':
			return 'top';
		case 'bottom':
			return 'bottom';
		case 'maximize':
			return 'full';
		default: {
			const _exhaustive: never = zone;
			return _exhaustive;
		}
	}
}

/** Opposite half for pairing a new pane beside an existing one. */
export function oppositeSlot(slot: PaneSlot): PaneSlot | null {
	switch (slot) {
		case 'left':
			return 'right';
		case 'right':
			return 'left';
		case 'top':
			return 'bottom';
		case 'bottom':
			return 'top';
		case 'full':
			return null;
		default: {
			const _exhaustive: never = slot;
			return _exhaustive;
		}
	}
}

export function slotToZone(slot: PaneSlot): SnapZone {
	switch (slot) {
		case 'left':
			return 'left';
		case 'right':
			return 'right';
		case 'top':
			return 'top';
		case 'bottom':
			return 'bottom';
		case 'full':
			return 'maximize';
		default: {
			const _exhaustive: never = slot;
			return _exhaustive;
		}
	}
}

/**
 * Apply a snap: place `noteId` into `zone`, reshaping existing panes as needed.
 * Returns the next pane list (max 2 for v1).
 */
export function applySnap(panes: EditorPane[], noteId: string, zone: SnapZone): EditorPane[] {
	const slot = zoneToSlot(zone);
	const existing = panes.find((p) => p.noteId === noteId);

	if (zone === 'maximize' || slot === 'full') {
		return [{ id: existing?.id ?? newPaneId(), noteId, slot: 'full' }];
	}

	const others = panes.filter((p) => p.noteId !== noteId);

	if (others.length === 0) {
		return [{ id: existing?.id ?? newPaneId(), noteId, slot }];
	}

	// Keep at most one partner on the opposite side.
	const partner = others[0]!;
	const opp = oppositeSlot(slot) ?? 'right';
	return [
		{ id: partner.id, noteId: partner.noteId, slot: opp },
		{ id: existing?.id ?? newPaneId(), noteId, slot }
	];
}

/** Open two notes as a horizontal split (selection → split edit). */
export function applySplitPair(leftNoteId: string, rightNoteId: string): EditorPane[] {
	if (leftNoteId === rightNoteId) {
		return [{ id: newPaneId(), noteId: leftNoteId, slot: 'full' }];
	}
	return [
		{ id: newPaneId(), noteId: leftNoteId, slot: 'left' },
		{ id: newPaneId(), noteId: rightNoteId, slot: 'right' }
	];
}

export function closePane(panes: EditorPane[], paneId: string): EditorPane[] {
	const next = panes.filter((p) => p.id !== paneId);
	// Keep the survivor in its half so the empty drop target remains.
	return next;
}

export function createEditorStage() {
	let panes = $state<EditorPane[]>([]);
	let activeNoteId = $state<string | null>(null);
	/** Horizontal split: fraction for the left pane (0.2–0.8). */
	let splitH = $state(0.5);
	/** Vertical split: fraction for the top pane. */
	let splitV = $state(0.5);
	/** Live snap preview while dragging (canvas or title bar). */
	let previewZone = $state<SnapZone | null>(null);

	const layout = $derived(layoutOf(panes));
	const open = $derived(panes.length > 0);
	const emptySlot = $derived(emptySlotOf(panes));

	function openNote(noteId: string, zone: SnapZone = 'maximize') {
		panes = applySnap(panes, noteId, zone);
		activeNoteId = noteId;
		previewZone = null;
	}

	function openSplit(leftNoteId: string, rightNoteId: string) {
		panes = applySplitPair(leftNoteId, rightNoteId);
		activeNoteId = leftNoteId;
		previewZone = null;
		splitH = 0.5;
	}

	/** Place note into the empty half, or open beside the current full pane. */
	function openBeside(noteId: string) {
		const empty = emptySlotOf(panes);
		if (empty) {
			openNote(noteId, slotToZone(empty));
			return;
		}
		if (panes.length === 1 && panes[0]!.slot === 'full') {
			const primary = panes[0]!.noteId;
			if (primary === noteId) return;
			openSplit(primary, noteId);
			return;
		}
		if (panes.length === 0) {
			openNote(noteId, 'left');
			return;
		}
		// Already split: replace the inactive side.
		const other = panes.find((p) => p.noteId !== activeNoteId) ?? panes[1];
		if (other) {
			openNote(noteId, slotToZone(other.slot));
		}
	}

	function snapPane(paneId: string, zone: SnapZone) {
		const pane = panes.find((p) => p.id === paneId);
		if (!pane) return;
		panes = applySnap(panes, pane.noteId, zone);
		activeNoteId = pane.noteId;
		previewZone = null;
	}

	function dismissPane(paneId: string) {
		const was = panes.find((p) => p.id === paneId);
		panes = closePane(panes, paneId);
		if (was && activeNoteId === was.noteId) {
			activeNoteId = panes[0]?.noteId ?? null;
		}
	}

	function dismissAll() {
		panes = [];
		activeNoteId = null;
		previewZone = null;
	}

	function setPreview(zone: SnapZone | null) {
		previewZone = zone;
	}

	function setSplitH(ratio: number) {
		splitH = Math.min(0.8, Math.max(0.2, ratio));
	}

	function setSplitV(ratio: number) {
		splitV = Math.min(0.8, Math.max(0.2, ratio));
	}

	function focusNote(noteId: string) {
		if (panes.some((p) => p.noteId === noteId)) activeNoteId = noteId;
	}

	return {
		get panes() {
			return panes;
		},
		get activeNoteId() {
			return activeNoteId;
		},
		get splitH() {
			return splitH;
		},
		get splitV() {
			return splitV;
		},
		get previewZone() {
			return previewZone;
		},
		get layout() {
			return layout;
		},
		get open() {
			return open;
		},
		get emptySlot() {
			return emptySlot;
		},
		openNote,
		openSplit,
		openBeside,
		snapPane,
		dismissPane,
		dismissAll,
		setPreview,
		setSplitH,
		setSplitV,
		focusNote
	};
}

export type EditorStageStore = ReturnType<typeof createEditorStage>;
