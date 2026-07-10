/**
 * Canvas geometry helpers — snap, bounds, align, fit.
 */

export const GRID = 24;

/** Auto-place / import: 4-wide grid on Snap multiples (not 40/160, which drift under Snap). */
export const GRID_COLS = 4;
export const GRID_ORIGIN = GRID * 2; // 48
export const GRID_SLOT_W = GRID * 10; // 240 — fits 220-wide cards with a 20px gutter
export const GRID_SLOT_H = GRID * 6; // 144 — 120-tall cards + 24px gutter

/** Board position for the nth auto-placed card (0-based). Always Snap-aligned. */
export function gridSlotPosition(index: number, cols = GRID_COLS): { x: number; y: number } {
	const c = Math.max(1, cols);
	return {
		x: GRID_ORIGIN + (index % c) * GRID_SLOT_W,
		y: GRID_ORIGIN + Math.floor(index / c) * GRID_SLOT_H
	};
}

export type AlignMode =
	| 'left'
	| 'center'
	| 'right'
	| 'top'
	| 'middle'
	| 'bottom'
	| 'distribute-h'
	| 'distribute-v'
	| 'stack'
	| 'grid';

export type Rect = { id: string; x: number; y: number; w: number; h: number };

export function snapValue(n: number, grid = GRID): number {
	if (grid <= 0) return n;
	return Math.round(n / grid) * grid;
}

export function snapPoint(x: number, y: number, grid = GRID): { x: number; y: number } {
	return { x: snapValue(x, grid), y: snapValue(y, grid) };
}

export function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

export function clampSize(
	w: number,
	h: number,
	bounds: { minW: number; minH: number; maxW: number; maxH: number }
): { w: number; h: number } {
	return {
		w: clamp(w, bounds.minW, bounds.maxW),
		h: clamp(h, bounds.minH, bounds.maxH)
	};
}

export function snapSize(
	w: number,
	h: number,
	grid = GRID,
	bounds?: { minW: number; minH: number; maxW: number; maxH: number }
): { w: number; h: number } {
	let next = { w: Math.max(grid, snapValue(w, grid)), h: Math.max(grid, snapValue(h, grid)) };
	if (bounds) next = clampSize(next.w, next.h, bounds);
	return next;
}

export function boundsOf(rects: Array<{ x: number; y: number; w: number; h: number }>): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	width: number;
	height: number;
} | null {
	if (rects.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const r of rects) {
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.w);
		maxY = Math.max(maxY, r.y + r.h);
	}
	return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Pack / arrange gap — same as Snap grid so Align keeps cards on-lattice. */
const ALIGN_GAP = GRID;

function packColumn(
	rects: Rect[],
	alignX: (r: Rect) => number,
	gap = ALIGN_GAP
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
	let y = sorted[0]?.y ?? 0;
	for (const r of sorted) {
		out.set(r.id, { x: alignX(r), y });
		y += r.h + gap;
	}
	return out;
}

function packRow(
	rects: Rect[],
	alignY: (r: Rect) => number,
	gap = ALIGN_GAP
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y);
	let x = sorted[0]?.x ?? 0;
	for (const r of sorted) {
		out.set(r.id, { x, y: alignY(r) });
		x += r.w + gap;
	}
	return out;
}

export function alignRects(rects: Rect[], mode: AlignMode): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	if (rects.length === 0) return out;
	const b = boundsOf(rects);
	if (!b) return out;

	switch (mode) {
		// Horizontal edge aligns → tidy vertical column (no overlap).
		case 'left':
			return packColumn(rects, () => b.minX);
		case 'center': {
			const mid = (b.minX + b.maxX) / 2;
			return packColumn(rects, (r) => mid - r.w / 2);
		}
		case 'right':
			return packColumn(rects, (r) => b.maxX - r.w);
		// Vertical edge aligns → tidy horizontal row (no overlap).
		case 'top':
			return packRow(rects, () => b.minY);
		case 'middle': {
			const mid = (b.minY + b.maxY) / 2;
			return packRow(rects, (r) => mid - r.h / 2);
		}
		case 'bottom':
			return packRow(rects, (r) => b.maxY - r.h);
		case 'distribute-h': {
			if (rects.length < 3) {
				for (const r of rects) out.set(r.id, { x: r.x, y: r.y });
				break;
			}
			// Equal gaps between card edges (not left-edges), first/last stay put.
			const sorted = [...rects].sort((a, b2) => a.x - b2.x);
			const first = sorted[0];
			const last = sorted[sorted.length - 1];
			const totalW = sorted.reduce((s, r) => s + r.w, 0);
			const span = last.x + last.w - first.x;
			const gap = Math.max(ALIGN_GAP, (span - totalW) / (sorted.length - 1));
			let cursor = first.x;
			sorted.forEach((r, i) => {
				if (i === 0) {
					out.set(r.id, { x: first.x, y: r.y });
					cursor = first.x + r.w + gap;
					return;
				}
				out.set(r.id, { x: cursor, y: r.y });
				cursor += r.w + gap;
			});
			break;
		}
		case 'distribute-v': {
			if (rects.length < 3) {
				for (const r of rects) out.set(r.id, { x: r.x, y: r.y });
				break;
			}
			const sorted = [...rects].sort((a, b2) => a.y - b2.y);
			const first = sorted[0];
			const last = sorted[sorted.length - 1];
			const totalH = sorted.reduce((s, r) => s + r.h, 0);
			const span = last.y + last.h - first.y;
			const gap = Math.max(ALIGN_GAP, (span - totalH) / (sorted.length - 1));
			let cursor = first.y;
			sorted.forEach((r, i) => {
				if (i === 0) {
					out.set(r.id, { x: r.x, y: first.y });
					cursor = first.y + r.h + gap;
					return;
				}
				out.set(r.id, { x: r.x, y: cursor });
				cursor += r.h + gap;
			});
			break;
		}
		case 'stack': {
			const originX = b.minX;
			const originY = b.minY;
			rects.forEach((r, i) => {
				out.set(r.id, { x: originX + i * 18, y: originY + i * 16 });
			});
			break;
		}
		case 'grid': {
			const cols = Math.ceil(Math.sqrt(rects.length));
			const gap = ALIGN_GAP;
			const cellW = Math.max(...rects.map((r) => r.w));
			const cellH = Math.max(...rects.map((r) => r.h));
			const sorted = [...rects].sort((a, b2) => a.y - b2.y || a.x - b2.x);
			sorted.forEach((r, i) => {
				const col = i % cols;
				const row = Math.floor(i / cols);
				out.set(r.id, {
					x: b.minX + col * (cellW + gap),
					y: b.minY + row * (cellH + gap)
				});
			});
			break;
		}
		default: {
			const _exhaustive: never = mode;
			return _exhaustive;
		}
	}
	return out;
}

export function fitViewport(
	bounds: { minX: number; minY: number; width: number; height: number },
	viewW: number,
	viewH: number,
	padding = 48
): { panX: number; panY: number; scale: number } {
	const usableW = Math.max(1, viewW - padding * 2);
	const usableH = Math.max(1, viewH - padding * 2);
	const bw = Math.max(1, bounds.width);
	const bh = Math.max(1, bounds.height);
	const scale = clamp(Math.min(usableW / bw, usableH / bh), 0.4, 2);
	const contentW = bw * scale;
	const contentH = bh * scale;
	const panX = (viewW - contentW) / 2 - bounds.minX * scale;
	const panY = (viewH - contentH) / 2 - bounds.minY * scale;
	return { panX, panY, scale };
}

const CASCADE_STEP_X = GRID; // 24 — stay on Snap lattice when cascading
const CASCADE_STEP_Y = GRID;
const CASCADE_MOD = 8;
const OVERLAP_RATIO = 0.55;
const NUDGE_STEP = GRID * 2; // 48 — stay on Snap lattice when spiraling
const NUDGE_MAX = 12;

function rectOverlapRatio(
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
	const area = aw * ah;
	if (area <= 0) return 0;
	return (iw * ih) / area;
}

function heavilyOverlaps(
	x: number,
	y: number,
	w: number,
	h: number,
	existing: Array<{ x: number; y: number; w: number; h: number }>
): boolean {
	for (const r of existing) {
		if (rectOverlapRatio(x, y, w, h, r.x, r.y, r.w, r.h) >= OVERLAP_RATIO) return true;
	}
	return false;
}

/**
 * Board-space top-left for a card centered in the current viewport,
 * with a light cascade so rapid spawns don't perfectly stack.
 * Optionally nudges away from heavily overlapping existing cards.
 */
export function viewCenterPlacement(opts: {
	panX: number;
	panY: number;
	scale: number;
	viewW: number;
	viewH: number;
	cardW: number;
	cardH: number;
	index?: number;
	existing?: Array<{ x: number; y: number; w: number; h: number }>;
}): { x: number; y: number } {
	const scale = opts.scale > 0 ? opts.scale : 1;
	const cascade = (opts.index ?? 0) % CASCADE_MOD;
	const centerBoardX = (opts.viewW / 2 - opts.panX) / scale;
	const centerBoardY = (opts.viewH / 2 - opts.panY) / scale;
	let x = centerBoardX - opts.cardW / 2 + cascade * CASCADE_STEP_X;
	let y = centerBoardY - opts.cardH / 2 + cascade * CASCADE_STEP_Y;

	const existing = opts.existing ?? [];
	if (existing.length > 0 && heavilyOverlaps(x, y, opts.cardW, opts.cardH, existing)) {
		// Spiral outward until clear or give up.
		for (let i = 1; i <= NUDGE_MAX; i++) {
			const ring = Math.ceil(i / 4);
			const side = (i - 1) % 4;
			const dx = side === 0 ? ring : side === 2 ? -ring : 0;
			const dy = side === 1 ? ring : side === 3 ? -ring : 0;
			const nx = x + dx * NUDGE_STEP;
			const ny = y + dy * NUDGE_STEP;
			if (!heavilyOverlaps(nx, ny, opts.cardW, opts.cardH, existing)) {
				x = nx;
				y = ny;
				break;
			}
		}
	}

	return { x: snapValue(x), y: snapValue(y) };
}

/**
 * Pan (keeping scale) so a board-space rect sits comfortably in the viewport.
 * No-op when already mostly visible.
 */
export function panToShowRect(
	rect: { x: number; y: number; w: number; h: number },
	viewport: { panX: number; panY: number; scale: number; viewW: number; viewH: number },
	padding = 48
): { panX: number; panY: number } {
	const scale = viewport.scale > 0 ? viewport.scale : 1;
	const viewLeft = -viewport.panX / scale;
	const viewTop = -viewport.panY / scale;
	const viewRight = viewLeft + viewport.viewW / scale;
	const viewBottom = viewTop + viewport.viewH / scale;

	const pad = padding / scale;
	const visibleW = Math.max(0, Math.min(rect.x + rect.w, viewRight) - Math.max(rect.x, viewLeft));
	const visibleH = Math.max(0, Math.min(rect.y + rect.h, viewBottom) - Math.max(rect.y, viewTop));
	const visibleRatio = rect.w * rect.h > 0 ? (visibleW * visibleH) / (rect.w * rect.h) : 0;

	if (visibleRatio >= 0.65) {
		return { panX: viewport.panX, panY: viewport.panY };
	}

	// Center the rect in the view at the current scale.
	const panX = viewport.viewW / 2 - (rect.x + rect.w / 2) * scale;
	const panY = viewport.viewH / 2 - (rect.y + rect.h / 2) * scale;
	// Prefer a slight bias toward padding when the card is huge; still center.
	void pad;
	return { panX, panY };
}

const BUMP_GAP = GRID; // 24 — keep bumped cards on the Snap lattice
const BUMP_MAX_PASSES = 16;
/** Cards within this x/y delta are treated as the same column/row. */
const BAND_ALIGN = 48;

type BumpRect = { id: string; x: number; y: number; w: number; h: number };
type BumpDir = 'right' | 'left' | 'down' | 'up';

function rectsOverlapWithGap(a: BumpRect, b: BumpRect, gap: number): boolean {
	return !(
		a.x + a.w + gap <= b.x ||
		b.x + b.w + gap <= a.x ||
		a.y + a.h + gap <= b.y ||
		b.y + b.h + gap <= a.y
	);
}

/** Same grid column = similar left edges (ignore tall expand centers). */
function sameColumn(a: BumpRect, b: BumpRect): boolean {
	return Math.abs(a.x - b.x) <= BAND_ALIGN;
}

/** Same grid row = similar top edges. */
function sameRow(a: BumpRect, b: BumpRect): boolean {
	return Math.abs(a.y - b.y) <= BAND_ALIGN;
}

/**
 * Prefer row/column axes so a grid stays a grid (not shortest-path stagger).
 */
function preferredPushDir(fixed: BumpRect, other: BumpRect): BumpDir {
	const ocx = other.x + other.w / 2;
	const ocy = other.y + other.h / 2;
	const fcx = fixed.x + fixed.w / 2;
	const fcy = fixed.y + fixed.h / 2;
	const dx = ocx - fcx;
	const dy = ocy - fcy;

	const col = sameColumn(fixed, other);
	const row = sameRow(fixed, other);
	if (col && !row) return dy >= 0 ? 'down' : 'up';
	if (row && !col) return dx >= 0 ? 'right' : 'left';
	// Diagonal / ambiguous: prefer the dominant center offset.
	if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'down' : 'up';
	return dx >= 0 ? 'right' : 'left';
}

function pushAmountInDir(fixed: BumpRect, other: BumpRect, dir: BumpDir, gap: number): number {
	if (!rectsOverlapWithGap(fixed, other, gap)) return 0;
	switch (dir) {
		case 'right':
			return Math.max(0, fixed.x + fixed.w + gap - other.x);
		case 'left':
			return Math.max(0, other.x + other.w + gap - fixed.x);
		case 'down':
			return Math.max(0, fixed.y + fixed.h + gap - other.y);
		case 'up':
			return Math.max(0, other.y + other.h + gap - fixed.y);
		default: {
			const _exhaustive: never = dir;
			void _exhaustive;
			return 0;
		}
	}
}

function bandKey(n: number): number {
	return Math.round(n / BAND_ALIGN);
}

function applyAxisShift(
	positions: Map<string, BumpRect>,
	origins: Map<string, { x: number; y: number }>,
	anchor: BumpRect,
	axis: 'y' | 'x',
	gap: number
): boolean {
	let needPos = 0;
	let needNeg = 0;
	const hitPos = new Set<string>();
	const hitNeg = new Set<string>();

	for (const rect of positions.values()) {
		if (!rectsOverlapWithGap(anchor, rect, gap)) continue;
		const dir = preferredPushDir(anchor, rect);
		if (axis === 'y' && dir !== 'down' && dir !== 'up') continue;
		if (axis === 'x' && dir !== 'right' && dir !== 'left') continue;
		const amount = pushAmountInDir(anchor, rect, dir, gap);
		if (amount <= 0) continue;
		if (dir === 'down' || dir === 'right') {
			needPos = Math.max(needPos, amount);
			hitPos.add(rect.id);
		} else {
			needNeg = Math.max(needNeg, amount);
			hitNeg.add(rect.id);
		}
	}

	if (needPos === 0 && needNeg === 0) return false;

	const bandsPos = new Set<number>();
	const bandsNeg = new Set<number>();
	for (const id of hitPos) {
		const o = origins.get(id);
		if (!o) continue;
		bandsPos.add(bandKey(axis === 'y' ? o.y : o.x));
	}
	for (const id of hitNeg) {
		const o = origins.get(id);
		if (!o) continue;
		bandsNeg.add(bandKey(axis === 'y' ? o.y : o.x));
	}

	// Pull in same-column (vertical) / same-row (horizontal) stack mates
	// so chains under the expand stay on the grid.
	for (const rect of positions.values()) {
		const o = origins.get(rect.id)!;
		const originRect = { ...rect, x: o.x, y: o.y };
		if (axis === 'y' && sameColumn(anchor, originRect)) {
			if (needPos > 0 && o.y + rect.h / 2 >= anchor.y + anchor.h / 2) {
				bandsPos.add(bandKey(o.y));
				hitPos.add(rect.id);
			}
			if (needNeg > 0 && o.y + rect.h / 2 < anchor.y + anchor.h / 2) {
				bandsNeg.add(bandKey(o.y));
				hitNeg.add(rect.id);
			}
		}
		if (axis === 'x' && sameRow(anchor, originRect)) {
			if (needPos > 0 && o.x + rect.w / 2 >= anchor.x + anchor.w / 2) {
				bandsPos.add(bandKey(o.x));
				hitPos.add(rect.id);
			}
			if (needNeg > 0 && o.x + rect.w / 2 < anchor.x + anchor.w / 2) {
				bandsNeg.add(bandKey(o.x));
				hitNeg.add(rect.id);
			}
		}
	}

	let changed = false;
	for (const rect of positions.values()) {
		const o = origins.get(rect.id)!;
		if (axis === 'y') {
			const yBand = bandKey(o.y);
			if (needPos > 0 && bandsPos.has(yBand) && o.y + rect.h / 2 >= anchor.y) {
				rect.y += needPos;
				changed = true;
			} else if (needNeg > 0 && bandsNeg.has(yBand) && o.y + rect.h / 2 < anchor.y + anchor.h) {
				rect.y -= needNeg;
				changed = true;
			}
		} else {
			const xBand = bandKey(o.x);
			if (needPos > 0 && bandsPos.has(xBand) && o.x + rect.w / 2 >= anchor.x) {
				rect.x += needPos;
				changed = true;
			} else if (needNeg > 0 && bandsNeg.has(xBand) && o.x + rect.w / 2 < anchor.x + anchor.w) {
				rect.x -= needNeg;
				changed = true;
			}
		}
	}
	return changed;
}

/**
 * Keep `anchor` fixed and make room by shifting whole row/column bands
 * together — so a snapped grid stays a grid instead of staggering.
 * Vertical bands first, then horizontal, so rows stay aligned.
 */
export function bumpOverlappingRects(
	anchor: BumpRect,
	others: BumpRect[],
	gap = BUMP_GAP
): Map<string, { x: number; y: number }> {
	const moved = new Map<string, { x: number; y: number }>();
	if (others.length === 0) return moved;

	const origins = new Map<string, { x: number; y: number }>();
	const positions = new Map<string, BumpRect>();
	for (const o of others) {
		if (o.id === anchor.id) continue;
		origins.set(o.id, { x: o.x, y: o.y });
		positions.set(o.id, { ...o });
	}

	// Row shifts first so a whole grid row moves together; then columns.
	applyAxisShift(positions, origins, anchor, 'y', gap);
	applyAxisShift(positions, origins, anchor, 'x', gap);

	// Resolve leftover pairwise overlaps (dense packs) without undoing bands.
	for (let pass = 0; pass < BUMP_MAX_PASSES; pass++) {
		let changed = false;
		const list = [...positions.values()];

		for (const rect of list) {
			if (!rectsOverlapWithGap(anchor, rect, gap)) continue;
			const dir = preferredPushDir(anchor, rect);
			const amount = pushAmountInDir(anchor, rect, dir, gap);
			if (amount <= 0) continue;
			if (dir === 'down') rect.y += amount;
			else if (dir === 'up') rect.y -= amount;
			else if (dir === 'right') rect.x += amount;
			else rect.x -= amount;
			changed = true;
		}

		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i]!;
				const b = list[j]!;
				if (!rectsOverlapWithGap(a, b, gap)) continue;
				const aDist =
					(a.x + a.w / 2 - (anchor.x + anchor.w / 2)) ** 2 +
					(a.y + a.h / 2 - (anchor.y + anchor.h / 2)) ** 2;
				const bDist =
					(b.x + b.w / 2 - (anchor.x + anchor.w / 2)) ** 2 +
					(b.y + b.h / 2 - (anchor.y + anchor.h / 2)) ** 2;
				const fixed = aDist <= bDist ? a : b;
				const mobile = aDist <= bDist ? b : a;
				const dir = preferredPushDir(fixed, mobile);
				const amount = pushAmountInDir(fixed, mobile, dir, gap);
				if (amount <= 0) continue;
				if (dir === 'down') mobile.y += amount;
				else if (dir === 'up') mobile.y -= amount;
				else if (dir === 'right') mobile.x += amount;
				else mobile.x -= amount;
				changed = true;
			}
		}

		if (!changed) break;
	}

	for (const rect of positions.values()) {
		const origin = origins.get(rect.id);
		if (!origin) continue;
		const snapped = snapAway(origin, rect);
		if (snapped.x === origin.x && snapped.y === origin.y) continue;
		moved.set(rect.id, snapped);
	}

	return moved;
}

/** Snap in the direction of travel so we never pull a bumped card back into overlap. */
function snapAway(
	origin: { x: number; y: number },
	pos: { x: number; y: number },
	grid = GRID
): { x: number; y: number } {
	const sx =
		pos.x > origin.x
			? Math.ceil(pos.x / grid) * grid
			: pos.x < origin.x
				? Math.floor(pos.x / grid) * grid
				: snapValue(pos.x, grid);
	const sy =
		pos.y > origin.y
			? Math.ceil(pos.y / grid) * grid
			: pos.y < origin.y
				? Math.floor(pos.y / grid) * grid
				: snapValue(pos.y, grid);
	return { x: sx, y: sy };
}

/**
 * Snap every rect to the nearest grid point, then push overlaps apart
 * while staying on the lattice. Earlier (top-left) cards stay preferred.
 */
export function snapRectsWithoutOverlap(
	rects: Rect[],
	opts?: { gap?: number; grid?: number }
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	if (rects.length === 0) return out;
	const gap = opts?.gap ?? BUMP_GAP;
	const grid = opts?.grid ?? GRID;

	const current: BumpRect[] = rects.map((r) => {
		const s = snapPoint(r.x, r.y, grid);
		return { id: r.id, x: s.x, y: s.y, w: r.w, h: r.h };
	});
	current.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));

	const byId = new Map(current.map((r) => [r.id, r]));

	const applyMoved = (moved: Map<string, { x: number; y: number }>) => {
		let changed = false;
		for (const [id, pos] of moved) {
			const rect = byId.get(id);
			if (!rect) continue;
			if (rect.x === pos.x && rect.y === pos.y) continue;
			rect.x = pos.x;
			rect.y = pos.y;
			changed = true;
		}
		return changed;
	};

	const anyOverlap = (): boolean => {
		for (let i = 0; i < current.length; i++) {
			for (let j = i + 1; j < current.length; j++) {
				if (rectsOverlapWithGap(current[i]!, current[j]!, gap)) return true;
			}
		}
		return false;
	};

	// Reading order: keep earlier cards fixed, bump later ones clear.
	for (let i = 0; i < current.length; i++) {
		const anchor = current[i]!;
		const others = current.slice(i + 1);
		if (others.length === 0) continue;
		applyMoved(bumpOverlappingRects(anchor, others, gap));
	}

	// One settle pass only if overlaps remain (dense packs).
	if (anyOverlap()) {
		for (let i = 0; i < current.length; i++) {
			const anchor = current[i]!;
			const others = current.filter((r) => r.id !== anchor.id);
			if (!applyMoved(bumpOverlappingRects(anchor, others, gap))) continue;
			if (!anyOverlap()) break;
		}
	}

	for (const rect of current) {
		out.set(rect.id, { x: rect.x, y: rect.y });
	}
	return out;
}

/**
 * Keep `moved` cards fixed (already snapped) and push overlapping neighbors clear.
 * Returns positions for any card that changed (moved + bumped).
 */
export function resolveOverlapsKeepingFixed(
	all: Rect[],
	fixedIds: Iterable<string>,
	gap = BUMP_GAP
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	const fixed = new Set(fixedIds);
	if (all.length === 0 || fixed.size === 0) return out;

	const byId = new Map(all.map((r) => [r.id, { ...r }]));
	for (const id of fixed) {
		const anchor = byId.get(id);
		if (!anchor) continue;
		const others = [...byId.values()].filter((r) => r.id !== id);
		const moved = bumpOverlappingRects(anchor, others, gap);
		for (const [mid, pos] of moved) {
			const rect = byId.get(mid);
			if (!rect) continue;
			rect.x = pos.x;
			rect.y = pos.y;
		}
	}

	for (const rect of byId.values()) {
		const origin = all.find((r) => r.id === rect.id);
		if (!origin) continue;
		if (origin.x === rect.x && origin.y === rect.y) continue;
		out.set(rect.id, { x: rect.x, y: rect.y });
	}
	return out;
}

const SNAP_PREF_KEY = 'mash.canvasSnap';

export function loadSnapPref(): boolean {
	try {
		return localStorage.getItem(SNAP_PREF_KEY) === '1';
	} catch {
		return false;
	}
}

export function saveSnapPref(on: boolean): void {
	try {
		localStorage.setItem(SNAP_PREF_KEY, on ? '1' : '0');
	} catch {
		/* ignore */
	}
}
