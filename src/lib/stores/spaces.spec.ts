import { describe, it, expect, beforeEach } from 'vitest';
import {
	OPEN_SPACES_STORAGE_KEY,
	DESK_SPACE_KEY,
	normalizeOpenKeys,
	readOpenSpaces,
	writeOpenSpaces,
	openSpaceInList,
	closeSpaceInList,
	spaceTitleForKey,
	filterFromSpaceKey,
	spaceKeyFromFilter,
	isSpaceKey
} from './spaces.svelte';
import { PINNED_CANVAS_KEY } from './note-library.svelte';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (k: string) => memory.get(k) ?? null,
		setItem: (k: string, v: string) => {
			memory.set(k, String(v));
		},
		removeItem: (k: string) => {
			memory.delete(k);
		},
		clear: () => memory.clear()
	},
	configurable: true
});

beforeEach(() => {
	memory.clear();
});

describe('open spaces helpers', () => {
	it('always keeps Desk first and unique', () => {
		expect(normalizeOpenKeys(['Research', '', 'Research', PINNED_CANVAS_KEY])).toEqual([
			DESK_SPACE_KEY,
			'Research',
			PINNED_CANVAS_KEY
		]);
	});

	it('persists and reads open keys', () => {
		writeOpenSpaces(['Clients', 'Writing']);
		expect(readOpenSpaces()).toEqual([DESK_SPACE_KEY, 'Clients', 'Writing']);
		expect(JSON.parse(memory.get(OPEN_SPACES_STORAGE_KEY)!)).toEqual([
			DESK_SPACE_KEY,
			'Clients',
			'Writing'
		]);
	});

	it('falls back to Desk on corrupt storage', () => {
		memory.set(OPEN_SPACES_STORAGE_KEY, '{not-json');
		expect(readOpenSpaces()).toEqual([DESK_SPACE_KEY]);
	});

	it('openSpaceInList is idempotent', () => {
		const a = openSpaceInList([DESK_SPACE_KEY], 'Ideas');
		expect(a).toEqual([DESK_SPACE_KEY, 'Ideas']);
		expect(openSpaceInList(a, 'Ideas')).toEqual(a);
	});

	it('cannot close Desk; closing active falls back to previous', () => {
		const keys = [DESK_SPACE_KEY, 'A', 'B'];
		expect(closeSpaceInList(keys, DESK_SPACE_KEY, 'A')).toEqual({
			keys,
			nextActive: null
		});
		expect(closeSpaceInList(keys, 'B', 'B')).toEqual({
			keys: [DESK_SPACE_KEY, 'A'],
			nextActive: 'A'
		});
		expect(closeSpaceInList(keys, 'A', 'B')).toEqual({
			keys: [DESK_SPACE_KEY, 'B'],
			nextActive: null
		});
	});

	it('titles and filters map correctly', () => {
		expect(spaceTitleForKey(DESK_SPACE_KEY)).toBe('Desk');
		expect(spaceTitleForKey(PINNED_CANVAS_KEY)).toBe('Pinned');
		expect(spaceTitleForKey('Research')).toBe('Research');
		expect(filterFromSpaceKey(DESK_SPACE_KEY)).toEqual({ type: null });
		expect(filterFromSpaceKey(PINNED_CANVAS_KEY)).toEqual({ type: 'pinned' });
		expect(filterFromSpaceKey('Research')).toEqual({ type: 'folder', value: 'Research' });
	});

	it('tag filters are not Spaces', () => {
		expect(spaceKeyFromFilter({ type: 'tag', value: 'x' })).toBeNull();
		expect(spaceKeyFromFilter({ type: 'folder', value: 'A' })).toBe('A');
		expect(spaceKeyFromFilter({ type: 'pinned' })).toBe(PINNED_CANVAS_KEY);
		expect(spaceKeyFromFilter({ type: null })).toBe(DESK_SPACE_KEY);
		expect(isSpaceKey('')).toBe(true);
		expect(isSpaceKey('A')).toBe(true);
	});
});
