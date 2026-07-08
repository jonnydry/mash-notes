import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadCanvasViewport,
	saveCanvasViewport,
	clearCanvasViewport
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
});
