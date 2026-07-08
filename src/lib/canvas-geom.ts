/**
 * Canvas geometry helpers — snap, bounds, align, fit.
 */

export const GRID = 24;

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

export function clamp(
	n: number,
	min: number,
	max: number
): number {
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

const ALIGN_GAP = 16;

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

const CASCADE_STEP_X = 28;
const CASCADE_STEP_Y = 24;
const CASCADE_MOD = 8;
const OVERLAP_RATIO = 0.55;
const NUDGE_STEP = 36;
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

	return { x, y };
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
	const visibleW = Math.max(
		0,
		Math.min(rect.x + rect.w, viewRight) - Math.max(rect.x, viewLeft)
	);
	const visibleH = Math.max(
		0,
		Math.min(rect.y + rect.h, viewBottom) - Math.max(rect.y, viewTop)
	);
	const visibleRatio =
		rect.w * rect.h > 0 ? (visibleW * visibleH) / (rect.w * rect.h) : 0;

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

const BUMP_GAP = 16;
const BUMP_MAX_PASSES = 16;

type BumpRect = { id: string; x: number; y: number; w: number; h: number };

function rectsOverlapWithGap(a: BumpRect, b: BumpRect, gap: number): boolean {
	return !(
		a.x + a.w + gap <= b.x ||
		b.x + b.w + gap <= a.x ||
		a.y + a.h + gap <= b.y ||
		b.y + b.h + gap <= a.y
	);
}

/**
 * Shortest axis-aligned push so `other` clears `fixed` with `gap`.
 * Prefers vertical on ties (column layouts).
 */
function pushAwayDelta(
	fixed: BumpRect,
	other: BumpRect,
	gap: number
): { dx: number; dy: number } | null {
	if (!rectsOverlapWithGap(fixed, other, gap)) return null;

	const pushRight = fixed.x + fixed.w + gap - other.x;
	const pushLeft = other.x + other.w + gap - fixed.x;
	const pushDown = fixed.y + fixed.h + gap - other.y;
	const pushUp = other.y + other.h + gap - fixed.y;

	const options = [
		{ dx: pushRight, dy: 0, mag: pushRight, vert: 0 },
		{ dx: -pushLeft, dy: 0, mag: pushLeft, vert: 0 },
		{ dx: 0, dy: pushDown, mag: pushDown, vert: 1 },
		{ dx: 0, dy: -pushUp, mag: pushUp, vert: 1 }
	];
	options.sort((a, b) => a.mag - b.mag || b.vert - a.vert);
	const best = options[0];
	if (!best || best.mag <= 0) return null;
	return { dx: best.dx, dy: best.dy };
}

/**
 * Keep `anchor` fixed and push overlapping neighbors clear (with gap).
 * Resolves chains so bumped cards don't land on each other.
 * Returns only cards that actually moved.
 */
export function bumpOverlappingRects(
	anchor: BumpRect,
	others: BumpRect[],
	gap = BUMP_GAP
): Map<string, { x: number; y: number }> {
	const moved = new Map<string, { x: number; y: number }>();
	if (others.length === 0) return moved;

	const positions = new Map<string, BumpRect>();
	for (const o of others) {
		if (o.id === anchor.id) continue;
		positions.set(o.id, { ...o });
	}

	const anchorCx = anchor.x + anchor.w / 2;
	const anchorCy = anchor.y + anchor.h / 2;

	for (let pass = 0; pass < BUMP_MAX_PASSES; pass++) {
		let changed = false;

		for (const rect of positions.values()) {
			const delta = pushAwayDelta(anchor, rect, gap);
			if (!delta) continue;
			rect.x += delta.dx;
			rect.y += delta.dy;
			moved.set(rect.id, { x: rect.x, y: rect.y });
			changed = true;
		}

		const list = [...positions.values()];
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = list[i];
				const b = list[j];
				if (!rectsOverlapWithGap(a, b, gap)) continue;
				const da =
					(a.x + a.w / 2 - anchorCx) ** 2 + (a.y + a.h / 2 - anchorCy) ** 2;
				const db =
					(b.x + b.w / 2 - anchorCx) ** 2 + (b.y + b.h / 2 - anchorCy) ** 2;
				const fixed = da <= db ? a : b;
				const mobile = da <= db ? b : a;
				const delta = pushAwayDelta(fixed, mobile, gap);
				if (!delta) continue;
				mobile.x += delta.dx;
				mobile.y += delta.dy;
				moved.set(mobile.id, { x: mobile.x, y: mobile.y });
				changed = true;
			}
		}

		if (!changed) break;
	}

	return moved;
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
