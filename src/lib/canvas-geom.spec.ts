import { describe, it, expect, beforeEach } from 'vitest';
import {
	snapValue,
	snapPoint,
	snapSize,
	clampSize,
	boundsOf,
	alignRects,
	fitViewport,
	viewCenterPlacement,
	measuredChromeClearance,
	screenBoxToBoardRect,
	panToShowRect,
	bumpOverlappingRects,
	gridSlotPosition,
	snapRectsWithoutOverlap,
	resolveOverlapsKeepingFixed,
	loadSnapPref,
	saveSnapPref,
	GRID,
	GRID_ORIGIN,
	GRID_SLOT_W,
	GRID_SLOT_H
} from './canvas-geom';

class MemoryStorage {
	private store = new Map<string, string>();
	clear() {
		this.store.clear();
	}
	getItem(key: string) {
		return this.store.has(key) ? this.store.get(key)! : null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
}

const memory = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
	value: memory,
	configurable: true
});

describe('canvas-geom', () => {
	beforeEach(() => memory.clear());

	it('snaps values to grid', () => {
		expect(snapValue(0, GRID)).toBe(0);
		expect(snapValue(11, GRID)).toBe(0);
		expect(snapValue(12, GRID)).toBe(24);
		expect(snapPoint(13, 35)).toEqual({ x: 24, y: 24 });
	});

	it('clamps and snaps sizes', () => {
		expect(clampSize(50, 50, { minW: 160, minH: 96, maxW: 480, maxH: 640 })).toEqual({
			w: 160,
			h: 96
		});
		expect(snapSize(230, 130).w % GRID).toBe(0);
	});

	it('computes bounds', () => {
		const b = boundsOf([
			{ x: 10, y: 20, w: 100, h: 50 },
			{ x: 50, y: 0, w: 80, h: 40 }
		]);
		expect(b).toEqual({ minX: 10, minY: 0, maxX: 130, maxY: 70, width: 120, height: 70 });
	});

	it('aligns left into a spaced vertical column', () => {
		const rects = [
			{ id: 'a', x: 40, y: 10, w: 20, h: 10 },
			{ id: 'b', x: 100, y: 30, w: 20, h: 10 },
			{ id: 'c', x: 10, y: 50, w: 20, h: 10 }
		];
		const left = alignRects(rects, 'left');
		// Sorted by y: a, b, c — all share leftmost x, packed with GRID gaps
		expect(left.get('a')).toEqual({ x: 10, y: 10 });
		expect(left.get('b')).toEqual({ x: 10, y: 44 });
		expect(left.get('c')).toEqual({ x: 10, y: 78 });

		const stacked = alignRects(rects, 'stack');
		expect(stacked.get('a')).toEqual({ x: 10, y: 10 });
		expect(stacked.get('b')).toEqual({ x: 28, y: 26 });
		expect(stacked.get('c')).toEqual({ x: 46, y: 42 });
	});

	it('aligns top into a spaced horizontal row', () => {
		const rects = [
			{ id: 'a', x: 40, y: 20, w: 20, h: 10 },
			{ id: 'b', x: 10, y: 50, w: 30, h: 10 }
		];
		const top = alignRects(rects, 'top');
		expect(top.get('b')).toEqual({ x: 10, y: 20 });
		expect(top.get('a')).toEqual({ x: 64, y: 20 });
	});

	it('distributes with even gaps between edges', () => {
		const rects = [
			{ id: 'a', x: 0, y: 0, w: 20, h: 10 },
			{ id: 'b', x: 40, y: 0, w: 20, h: 10 },
			{ id: 'c', x: 100, y: 0, w: 20, h: 10 }
		];
		const dist = alignRects(rects, 'distribute-h');
		expect(dist.get('a')?.x).toBe(0);
		// span 120, totalW 60 → raw gap 30 (≥ ALIGN_GAP 24) → middle at 50, last at 100
		expect(dist.get('b')?.x).toBe(50);
		expect(dist.get('c')?.x).toBe(100);
	});

	it('forces a minimum gap when distribute would overlap', () => {
		const rects = [
			{ id: 'a', x: 0, y: 0, w: 80, h: 10 },
			{ id: 'b', x: 10, y: 0, w: 80, h: 10 },
			{ id: 'c', x: 20, y: 0, w: 80, h: 10 }
		];
		const dist = alignRects(rects, 'distribute-h');
		expect(dist.get('a')?.x).toBe(0);
		expect(dist.get('b')?.x).toBe(104); // 80 + GRID
		expect(dist.get('c')?.x).toBe(208);
	});

	it('fits content into the viewport', () => {
		const v = fitViewport({ minX: 0, minY: 0, width: 400, height: 200 }, 800, 600, 0);
		expect(v.scale).toBe(2);
		expect(v.panX).toBe(0);
		expect(v.panY).toBe(100);
	});

	it('can preserve a readable minimum scale while centering oversized content', () => {
		const v = fitViewport({ minX: 0, minY: 0, width: 800, height: 200 }, 390, 700, 40, {
			min: 0.55
		});
		expect(v.scale).toBe(0.55);
		expect(v.panX).toBeCloseTo(-25);
	});

	it('places an empty desk at the view center', () => {
		const base = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100
		});
		expect(base).toEqual({ x: 312, y: 240 });

		const again = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100
		});
		expect(again).toEqual(base);

		const zoomed = viewCenterPlacement({
			panX: 100,
			panY: 50,
			scale: 2,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100
		});
		// center board = ((400-100)/2, (300-50)/2) = (150, 125); top-left = (50, 75) → snap (48, 72)
		expect(zoomed).toEqual({ x: 48, y: 72 });
	});

	it('nudges spawn away from heavy overlap', () => {
		const placed = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100,
			existing: [{ x: 300, y: 240, w: 200, h: 100 }]
		});
		expect(placed).not.toEqual({ x: 300, y: 240 });
		expect(placed.x % GRID).toBe(0);
		expect(placed.y % GRID).toBe(0);
	});

	it('steps aside when a larger card would cover a smaller one', () => {
		const covered = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100,
			existing: [{ x: 312, y: 240, w: 120, h: 80 }]
		});
		expect(covered).not.toEqual({ x: 312, y: 240 });
	});

	function placeSequence(
		count: number,
		view: { viewW: number; viewH: number; cardW: number; cardH: number }
	) {
		const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (let i = 0; i < count; i++) {
			const next = viewCenterPlacement({
				panX: 0,
				panY: 0,
				scale: 1,
				viewW: view.viewW,
				viewH: view.viewH,
				cardW: view.cardW,
				cardH: view.cardH,
				existing: placed
			});
			placed.push({ ...next, w: view.cardW, h: view.cardH });
		}
		return placed;
	}

	it('keeps 10 or more cards off the same spot', () => {
		const placed = placeSequence(12, { viewW: 1280, viewH: 800, cardW: 220, cardH: 120 });
		const spots = new Set(placed.map((card) => `${card.x},${card.y}`));
		expect(placed.length).toBeGreaterThanOrEqual(10);
		expect(spots.size).toBe(placed.length);
	});

	it('places 16 new notes inside a 1280×800 view without stacking', () => {
		const viewW = 1280;
		const viewH = 800;
		const cardW = 280;
		const cardH = 220;
		const placed = placeSequence(16, { viewW, viewH, cardW, cardH });
		const spots = new Set(placed.map((card) => `${card.x},${card.y}`));
		expect(spots.size).toBe(16);
		for (const card of placed) {
			expect(card.x).toBeGreaterThanOrEqual(0);
			expect(card.y).toBeGreaterThanOrEqual(0);
			expect(card.x + cardW).toBeLessThanOrEqual(viewW);
			expect(card.y + cardH).toBeLessThanOrEqual(viewH);
		}
	});

	it('stays inside a packed view and off every occupied spot', () => {
		const viewW = 1280;
		const viewH = 800;
		const cardW = 280;
		const cardH = 220;
		const origin = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW,
			viewH,
			cardW,
			cardH
		});
		const existing = [
			{ x: -2000, y: -2000, w: 8000, h: 8000 },
			...Array.from({ length: 8 }, (_, k) => ({
				x: origin.x + k * GRID,
				y: origin.y + k * GRID,
				w: cardW,
				h: cardH
			}))
		];
		const placed = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW,
			viewH,
			cardW,
			cardH,
			existing
		});
		expect(placed.x).toBeGreaterThanOrEqual(0);
		expect(placed.y).toBeGreaterThanOrEqual(0);
		expect(placed.x + cardW).toBeLessThanOrEqual(viewW);
		expect(placed.y + cardH).toBeLessThanOrEqual(viewH);
		expect(existing.some((card) => card.x === placed.x && card.y === placed.y)).toBe(false);
	});

	it('places 35 new notes inside a 1280×800 view on distinct spots', () => {
		const viewW = 1280;
		const viewH = 800;
		const cardW = 280;
		const cardH = 220;
		const placed = placeSequence(35, { viewW, viewH, cardW, cardH });
		const spots = new Set(placed.map((card) => `${card.x},${card.y}`));
		expect(spots.size).toBe(35);
		for (const card of placed) {
			expect(card.x).toBeGreaterThanOrEqual(0);
			expect(card.y).toBeGreaterThanOrEqual(0);
			expect(card.x + cardW).toBeLessThanOrEqual(viewW);
			expect(card.y + cardH).toBeLessThanOrEqual(viewH);
		}
	});

	function intersects(
		card: { x: number; y: number; w: number; h: number },
		obstacle: { x: number; y: number; w: number; h: number }
	) {
		return (
			card.x < obstacle.x + obstacle.w &&
			card.x + card.w > obstacle.x &&
			card.y < obstacle.y + obstacle.h &&
			card.y + card.h > obstacle.y
		);
	}

	it('keeps new cards clear of top controls, the bottom toolbar, and a visible toast', () => {
		const viewW = 1280;
		const viewH = 800;
		const cardW = 280;
		const cardH = 220;
		const topControls = { x: 760, y: 0, w: 520, h: 64 };
		const bottomToolbar = { x: 360, y: 730, w: 560, h: 70 };
		const toast = { x: 470, y: 680, w: 340, h: 52 };
		const obstacles = [topControls, bottomToolbar, toast];
		const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (let i = 0; i < 18; i++) {
			const next = viewCenterPlacement({
				panX: 0,
				panY: 0,
				scale: 1,
				viewW,
				viewH,
				cardW,
				cardH,
				existing: placed,
				obstacles
			});
			const card = { ...next, w: cardW, h: cardH };
			for (const obstacle of obstacles) {
				expect(intersects(card, obstacle)).toBe(false);
			}
			placed.push(card);
		}
		expect(new Set(placed.map((card) => `${card.x},${card.y}`)).size).toBe(placed.length);
	});

	it('uses the toast area when no toast is visible', () => {
		const viewW = 1280;
		const viewH = 800;
		const cardW = 280;
		const cardH = 220;
		const toastArea = { x: 400, y: 540, w: 480, h: 260 };
		const blockers = [
			{ x: -40, y: -40, w: 1360, h: 580 },
			{ x: -40, y: 520, w: 440, h: 320 },
			{ x: 880, y: 520, w: 480, h: 320 }
		];
		const open = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW,
			viewH,
			cardW,
			cardH,
			existing: [{ x: 0, y: 0, w: 24, h: 24 }],
			obstacles: blockers
		});
		const openCard = { ...open, w: cardW, h: cardH };
		expect(intersects(openCard, toastArea)).toBe(true);
		for (const blocker of blockers) expect(intersects(openCard, blocker)).toBe(false);

		const blocked = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW,
			viewH,
			cardW,
			cardH,
			existing: [{ x: 0, y: 0, w: 24, h: 24 }],
			obstacles: [...blockers, toastArea]
		});
		expect(intersects({ ...blocked, w: cardW, h: cardH }, toastArea)).toBe(false);
	});

	it('gives 10 oversized notes distinct top-lefts at 390×700 zoom 2', () => {
		const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (let i = 0; i < 12; i++) {
			const next = viewCenterPlacement({
				panX: 0,
				panY: 0,
				scale: 2,
				viewW: 390,
				viewH: 700,
				cardW: 280,
				cardH: 220,
				existing: placed
			});
			placed.push({ ...next, w: 280, h: 220 });
		}
		expect(new Set(placed.map((card) => `${card.x},${card.y}`)).size).toBe(12);
	});

	it('skips taken top-lefts when the card is larger than the view', () => {
		const origin = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 2,
			viewW: 390,
			viewH: 700,
			cardW: 280,
			cardH: 220
		});
		const existing = Array.from({ length: 10 }, (_, k) => ({
			x: origin.x + k * GRID,
			y: origin.y + k * GRID,
			w: 280,
			h: 220
		}));
		const placed = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 2,
			viewW: 390,
			viewH: 700,
			cardW: 280,
			cardH: 220,
			existing
		});
		expect(existing.some((card) => card.x === placed.x && card.y === placed.y)).toBe(false);
	});

	it('converts a measured chrome box into board space with its layout inset', () => {
		expect(
			measuredChromeClearance({ top: '12px', right: '12px', bottom: 'auto', left: 'auto' })
		).toBe(12);
		expect(
			screenBoxToBoardRect(
				{ left: 800, top: 20, width: 200, height: 40, clearance: 12 },
				{ left: 0, top: 0 },
				0,
				0,
				2
			)
		).toEqual({ x: 394, y: 4, w: 112, h: 32 });
	});

	it('auto-place slots stay on the Snap lattice', () => {
		expect(GRID_ORIGIN % GRID).toBe(0);
		expect(GRID_SLOT_W % GRID).toBe(0);
		expect(GRID_SLOT_H % GRID).toBe(0);
		expect(gridSlotPosition(0)).toEqual({ x: 48, y: 48 });
		expect(gridSlotPosition(1)).toEqual({ x: 288, y: 48 });
		expect(gridSlotPosition(4)).toEqual({ x: 48, y: 192 });
		for (let i = 0; i < 12; i++) {
			const p = gridSlotPosition(i);
			expect(p.x % GRID).toBe(0);
			expect(p.y % GRID).toBe(0);
		}
	});

	it('pans to show an off-screen rect without changing scale', () => {
		const same = panToShowRect(
			{ x: 100, y: 100, w: 200, h: 100 },
			{ panX: 0, panY: 0, scale: 1, viewW: 800, viewH: 600 }
		);
		expect(same).toEqual({ panX: 0, panY: 0 });

		const moved = panToShowRect(
			{ x: 2000, y: 1500, w: 200, h: 100 },
			{ panX: 0, panY: 0, scale: 1, viewW: 800, viewH: 600 }
		);
		expect(moved.panX).toBe(800 / 2 - (2000 + 100));
		expect(moved.panY).toBe(600 / 2 - (1500 + 50));
	});

	it('bumps overlapping neighbors away from an expanded anchor', () => {
		const anchor = { id: 'a', x: 0, y: 0, w: 360, h: 320 };
		const below = { id: 'b', x: 24, y: 144, w: 220, h: 120 };
		const moved = bumpOverlappingRects(anchor, [below], GRID);
		// 320 + GRID = 344 → outward snap to 360
		expect(moved.get('b')).toEqual({ x: 24, y: 360 });
	});

	it('chains bumps so neighbors do not land on each other', () => {
		const anchor = { id: 'a', x: 0, y: 0, w: 360, h: 320 };
		const mid = { id: 'b', x: 0, y: 192, w: 220, h: 120 };
		const low = { id: 'c', x: 0, y: 336, w: 220, h: 120 };
		const moved = bumpOverlappingRects(anchor, [mid, low], GRID);
		expect(moved.get('b')?.y).toBe(360);
		expect(moved.get('c')?.y).toBeGreaterThanOrEqual((moved.get('b')?.y ?? 0) + 120 + GRID);
		expect((moved.get('b')?.y ?? 0) % GRID).toBe(0);
		expect((moved.get('c')?.y ?? 0) % GRID).toBe(0);
	});

	it('shifts a whole grid row together when expanding', () => {
		// 2×2 snapped grid; expand top-left into the row below.
		const w = 220;
		const h = 120;
		const gap = GRID;
		const col2 = 240;
		const row2 = 144;
		const anchor = { id: 'a', x: 0, y: 0, w: 360, h: 320 };
		const right = { id: 'b', x: col2, y: 0, w, h };
		const below = { id: 'c', x: 0, y: row2, w, h };
		const belowRight = { id: 'd', x: col2, y: row2, w, h };
		const moved = bumpOverlappingRects(anchor, [right, below, belowRight], gap);

		expect(moved.get('c')?.y).toBe(360);
		expect(moved.get('d')?.y).toBe(moved.get('c')?.y);
		expect(moved.get('b')?.y ?? 0).toBe(0);
		expect(moved.get('d')?.x).toBe(moved.get('b')?.x ?? col2);
	});

	it('shifts a whole grid column together when expanding sideways', () => {
		const w = 220;
		const h = 120;
		const gap = GRID;
		const col2 = 192;
		const row2 = 144;
		const anchor = { id: 'a', x: 0, y: 0, w: 360, h: 320 };
		const right = { id: 'b', x: col2, y: 0, w, h };
		const belowRight = { id: 'c', x: col2, y: row2, w, h };
		const moved = bumpOverlappingRects(anchor, [right, belowRight], gap);

		const bx = moved.get('b')?.x ?? col2;
		expect(bx).toBeGreaterThanOrEqual(360 + gap);
		expect(bx % GRID).toBe(0);
		expect(moved.get('c')?.x ?? col2).toBe(bx);
	});

	it('persists snap preference', () => {
		expect(loadSnapPref()).toBe(false);
		saveSnapPref(true);
		expect(loadSnapPref()).toBe(true);
	});

	it('snapRectsWithoutOverlap snaps to grid and clears overlaps', () => {
		const next = snapRectsWithoutOverlap([
			{ id: 'a', x: 10, y: 10, w: 220, h: 120 },
			{ id: 'b', x: 30, y: 20, w: 220, h: 120 }
		]);
		const a = next.get('a')!;
		const b = next.get('b')!;
		expect(a.x % GRID).toBe(0);
		expect(a.y % GRID).toBe(0);
		expect(b.x % GRID).toBe(0);
		expect(b.y % GRID).toBe(0);
		// No overlap with GRID gap
		const overlapX = a.x < b.x + 220 + GRID && b.x < a.x + 220 + GRID;
		const overlapY = a.y < b.y + 120 + GRID && b.y < a.y + 120 + GRID;
		expect(overlapX && overlapY).toBe(false);
	});

	it('resolveOverlapsKeepingFixed keeps moved cards and bumps neighbors', () => {
		const next = resolveOverlapsKeepingFixed(
			[
				{ id: 'a', x: 0, y: 0, w: 220, h: 120 },
				{ id: 'b', x: 24, y: 24, w: 220, h: 120 }
			],
			['a'],
			GRID
		);
		expect(next.has('a')).toBe(false);
		expect(next.has('b')).toBe(true);
		const b = next.get('b')!;
		expect(b.x % GRID).toBe(0);
		expect(b.y % GRID).toBe(0);
	});
});
