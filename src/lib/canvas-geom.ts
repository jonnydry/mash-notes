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
