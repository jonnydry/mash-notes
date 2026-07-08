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
	panToShowRect,
	bumpOverlappingRects,
	loadSnapPref,
	saveSnapPref,
	GRID
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
		// Sorted by y: a, b, c — all share leftmost x, packed with 16px gaps
		expect(left.get('a')).toEqual({ x: 10, y: 10 });
		expect(left.get('b')).toEqual({ x: 10, y: 36 });
		expect(left.get('c')).toEqual({ x: 10, y: 62 });

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
		expect(top.get('a')).toEqual({ x: 56, y: 20 });
	});

	it('distributes with even gaps between edges', () => {
		const rects = [
			{ id: 'a', x: 0, y: 0, w: 20, h: 10 },
			{ id: 'b', x: 40, y: 0, w: 20, h: 10 },
			{ id: 'c', x: 100, y: 0, w: 20, h: 10 }
		];
		const dist = alignRects(rects, 'distribute-h');
		expect(dist.get('a')?.x).toBe(0);
		// span 120, totalW 60 → raw gap 30 (≥ ALIGN_GAP 16) → middle at 50, last at 100
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
		expect(dist.get('b')?.x).toBe(96); // 80 + 16
		expect(dist.get('c')?.x).toBe(192);
	});

	it('fits viewport into view', () => {
		const v = fitViewport({ minX: 0, minY: 0, width: 400, height: 200 }, 800, 600, 0);
		expect(v.scale).toBe(2);
		expect(v.panX).toBe(0);
		expect(v.panY).toBe(100);
	});

	it('places cards at the view center with cascade', () => {
		const base = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100,
			index: 0
		});
		expect(base).toEqual({ x: 300, y: 250 });

		const cascaded = viewCenterPlacement({
			panX: 0,
			panY: 0,
			scale: 1,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100,
			index: 1
		});
		expect(cascaded).toEqual({ x: 328, y: 274 });

		const zoomed = viewCenterPlacement({
			panX: 100,
			panY: 50,
			scale: 2,
			viewW: 800,
			viewH: 600,
			cardW: 200,
			cardH: 100,
			index: 0
		});
		// center board = ((400-100)/2, (300-50)/2) = (150, 125); top-left = (50, 75)
		expect(zoomed).toEqual({ x: 50, y: 75 });
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
			index: 0,
			existing: [{ x: 300, y: 250, w: 200, h: 100 }]
		});
		expect(placed).not.toEqual({ x: 300, y: 250 });
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
		const below = { id: 'b', x: 20, y: 140, w: 220, h: 120 };
		const moved = bumpOverlappingRects(anchor, [below], 16);
		expect(moved.get('b')).toEqual({ x: 20, y: 336 });
	});

	it('chains bumps so neighbors do not land on each other', () => {
		const anchor = { id: 'a', x: 0, y: 0, w: 360, h: 320 };
		const mid = { id: 'b', x: 10, y: 200, w: 220, h: 120 };
		const low = { id: 'c', x: 10, y: 340, w: 220, h: 120 };
		const moved = bumpOverlappingRects(anchor, [mid, low], 16);
		expect(moved.get('b')?.y).toBe(336);
		expect(moved.get('c')?.y).toBeGreaterThanOrEqual((moved.get('b')?.y ?? 0) + 120 + 16);
	});

	it('persists snap preference', () => {
		expect(loadSnapPref()).toBe(false);
		saveSnapPref(true);
		expect(loadSnapPref()).toBe(true);
	});
});
