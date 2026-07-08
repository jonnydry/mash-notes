import { describe, it, expect, beforeEach } from 'vitest';
import {
	dismissNoteFromCanvas,
	getDismissedNoteIds,
	undismissNoteFromCanvas,
	undismissNotesFromCanvas,
	clearDismissedForCanvas
} from './canvas-dismiss';

class MemoryStorage {
	private store = new Map<string, string>();
	clear() {
		this.store.clear();
	}
	get length() {
		return this.store.size;
	}
	key(index: number) {
		return [...this.store.keys()][index] ?? null;
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

describe('canvas-dismiss', () => {
	beforeEach(() => memory.clear());

	it('tracks dismissed notes per canvas', () => {
		dismissNoteFromCanvas('c1', 'n1');
		dismissNoteFromCanvas('c1', 'n2');
		expect([...getDismissedNoteIds('c1')].sort()).toEqual(['n1', 'n2']);
		expect(getDismissedNoteIds('c2').size).toBe(0);
	});

	it('undismisses on drop-back', () => {
		dismissNoteFromCanvas('c1', 'n1');
		undismissNoteFromCanvas('c1', 'n1');
		expect(getDismissedNoteIds('c1').size).toBe(0);
		dismissNoteFromCanvas('c1', 'n1');
		dismissNoteFromCanvas('c1', 'n2');
		undismissNotesFromCanvas('c1', ['n1']);
		expect([...getDismissedNoteIds('c1')]).toEqual(['n2']);
	});

	it('clears all dismissals for a canvas', () => {
		dismissNoteFromCanvas('c1', 'n1');
		clearDismissedForCanvas('c1');
		expect(getDismissedNoteIds('c1').size).toBe(0);
	});
});
