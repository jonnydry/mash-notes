import { describe, it, expect, beforeEach } from 'vitest';
import {
	snapValue,
	snapPoint,
	snapSize,
	clampSize,
	boundsOf,
	alignRects,
	fitViewport,
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

	it('persists snap preference', () => {
		expect(loadSnapPref()).toBe(false);
		saveSnapPref(true);
		expect(loadSnapPref()).toBe(true);
	});
});
