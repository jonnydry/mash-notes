import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadCanvasViewport,
	saveCanvasViewport,
	clearCanvasViewport,
	mobileAutoFitKey
} from './viewport';

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

describe('canvas viewport persistence', () => {
	beforeEach(() => {
		memory.clear();
	});

	it('returns defaults when nothing is stored', () => {
		expect(loadCanvasViewport('c1')).toEqual({ panX: 0, panY: 0, scale: 1 });
	});

	it('round-trips viewport values', () => {
		saveCanvasViewport('c1', { panX: 120, panY: -40, scale: 1.4 });
		expect(loadCanvasViewport('c1')).toEqual({ panX: 120, panY: -40, scale: 1.4 });
	});

	it('clamps invalid scale and ignores bad JSON', () => {
		saveCanvasViewport('c1', { panX: 10, panY: 20, scale: 9 });
		expect(loadCanvasViewport('c1').scale).toBe(2);
		memory.setItem('mash.canvasViewport.c2', '{not-json');
		expect(loadCanvasViewport('c2')).toEqual({ panX: 0, panY: 0, scale: 1 });
	});

	it('clears stored viewport', () => {
		saveCanvasViewport('c1', { panX: 1, panY: 2, scale: 1.1 });
		clearCanvasViewport('c1');
		expect(loadCanvasViewport('c1')).toEqual({ panX: 0, panY: 0, scale: 1 });
	});

	it('requests one mobile fit per desk entry after content and dimensions are ready', () => {
		const ready = {
			isMobile: true,
			canvasId: 'c1',
			itemCount: 2,
			boardWidth: 390,
			boardHeight: 700,
			entry: 1,
			lastAppliedKey: null
		};
		expect(mobileAutoFitKey(ready)).toBe('c1:1');
		expect(mobileAutoFitKey({ ...ready, lastAppliedKey: 'c1:1' })).toBeNull();
		expect(mobileAutoFitKey({ ...ready, canvasId: 'c2', lastAppliedKey: 'c1:1' })).toBe('c2:1');
		expect(mobileAutoFitKey({ ...ready, entry: 2, lastAppliedKey: 'c1:1' })).toBe('c1:2');
	});

	it('waits to fit until a mobile desk has content and a measurable board', () => {
		const input = {
			isMobile: true,
			canvasId: 'c1',
			itemCount: 1,
			boardWidth: 390,
			boardHeight: 700,
			entry: 1,
			lastAppliedKey: null
		};
		expect(mobileAutoFitKey({ ...input, isMobile: false })).toBeNull();
		expect(mobileAutoFitKey({ ...input, itemCount: 0 })).toBeNull();
		expect(mobileAutoFitKey({ ...input, boardWidth: 0 })).toBeNull();
		expect(mobileAutoFitKey({ ...input, canvasId: null })).toBeNull();
	});
});
