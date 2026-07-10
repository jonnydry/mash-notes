import { describe, it, expect, beforeEach } from 'vitest';
import {
	cardDisplaySize,
	computeExpandBumps,
	COLLAPSED_CARD,
	EXPANDED_CARD
} from './canvas-session.svelte';
import {
	dispatchDockAction,
	peelTitleFor,
	peelOpenPatch,
	windowPeelNotes,
	handleGlobalSearchInput,
	PEEL_UI_CAP,
	type DockActionHandlers
} from './peel-nav.svelte';
import {
	filterPeelNotes,
	uniqueFoldersFrom,
	canvasFolderFromFilter,
	canvasKeyFromFilter,
	canvasTitleFromFilter,
	PINNED_CANVAS_KEY
} from './note-library.svelte';
import { THEME_STORAGE_KEY, isMashTheme, readStoredTheme, THEME_META_COLOR } from './theme.svelte';
import type { Note } from '$lib/types';

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

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
	return {
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

describe('stores helpers', () => {
	it('cardDisplaySize uses expanded defaults', () => {
		const item = { id: 'i', canvasId: 'c', noteId: 'n', x: 0, y: 0 };
		expect(cardDisplaySize(item, 'n')).toEqual(EXPANDED_CARD);
		expect(cardDisplaySize(item, null)).toEqual(COLLAPSED_CARD);
	});

	it('computeExpandBumps pushes overlapping neighbors', () => {
		const items = [
			{ id: 'a', canvasId: 'c', noteId: 'n1', x: 0, y: 0, w: 220, h: 120 },
			{ id: 'b', canvasId: 'c', noteId: 'n2', x: 40, y: 40, w: 220, h: 120 }
		];
		const { moves, restore } = computeExpandBumps(items, 'a', EXPANDED_CARD, 'n1');
		expect(moves.length).toBeGreaterThan(0);
		expect(restore.size).toBe(moves.length);
	});

	it('peelTitleFor and open patch', () => {
		expect(peelTitleFor('linked', '', { type: null })).toBe('Linked');
		expect(peelTitleFor('conflicts', '', { type: null })).toBe('Conflicts');
		expect(peelTitleFor('notes', 'query', { type: null })).toBe('All notes');
		expect(peelTitleFor('notes', 'query', { type: 'pinned' })).toBe('Pinned');
		expect(peelOpenPatch('folders').foldersFlyout).toBe(true);
	});

	it('handleGlobalSearchInput never opens the peel', () => {
		expect(handleGlobalSearchInput('', 's')).toEqual({ searchQuery: 's', openPeel: false });
		expect(handleGlobalSearchInput('s', 'sc')).toEqual({ searchQuery: 'sc', openPeel: false });
		expect(handleGlobalSearchInput('sc', '')).toEqual({ searchQuery: '', openPeel: false });
	});

	it('windows peel notes', () => {
		const many = Array.from({ length: PEEL_UI_CAP + 10 }, (_, i) => i);
		expect(windowPeelNotes(many)).toHaveLength(PEEL_UI_CAP);
	});

	it('filters peel and folders', () => {
		const notes = [
			note({ id: '1', title: 'Alpha', folder: 'Ideas/Work', tags: ['x'] }),
			note({ id: '2', title: 'Beta', body: 'zzz' })
		];
		expect(filterPeelNotes(notes, 'alpha')).toHaveLength(1);
		expect(uniqueFoldersFrom(notes)).toEqual(['Ideas/Work']);
		expect(canvasFolderFromFilter({ type: 'folder', value: 'Ideas' })).toBe('Ideas');
		expect(canvasFolderFromFilter({ type: 'pinned' })).toBe('');
		expect(canvasKeyFromFilter({ type: 'pinned' })).toBe(PINNED_CANVAS_KEY);
		expect(canvasKeyFromFilter({ type: 'folder', value: 'Ideas' })).toBe('Ideas');
		expect(canvasTitleFromFilter({ type: 'pinned' })).toBe('Pinned');
		expect(canvasTitleFromFilter({ type: null })).toBe('Desk');
	});

	it('theme helpers validate and read storage', () => {
		expect(isMashTheme('light')).toBe(true);
		expect(isMashTheme('dark')).toBe(true);
		expect(isMashTheme('sepia')).toBe(false);
		expect(THEME_META_COLOR.light).toBe('#efe6d8');
		expect(THEME_META_COLOR.dark).toBe('#0e0c0a');

		localStorage.removeItem(THEME_STORAGE_KEY);
		expect(readStoredTheme()).toBe('dark');
		localStorage.setItem(THEME_STORAGE_KEY, 'light');
		expect(readStoredTheme()).toBe('light');
		localStorage.setItem(THEME_STORAGE_KEY, 'nope');
		expect(readStoredTheme()).toBe('dark');
	});

	it('dispatchDockAction toggles settings and closes peel', () => {
		let settingsOpen = false;
		let peelClosed = false;
		const h: DockActionHandlers = {
			clearFilter: () => {},
			setFilter: () => {},
			openPeel: () => {},
			closePeel: () => {
				peelClosed = true;
			},
			getPeelOpen: () => true,
			getPeelMode: () => 'notes',
			setLinkedFocus: () => {},
			resolveLinkedFocus: () => null,
			newNote: () => {},
			focusSearch: () => {},
			getSettingsOpen: () => settingsOpen,
			openSettings: () => {
				settingsOpen = true;
			},
			closeSettings: () => {
				settingsOpen = false;
			}
		};

		dispatchDockAction('settings', h);
		expect(settingsOpen).toBe(true);
		expect(peelClosed).toBe(true);

		dispatchDockAction('settings', h);
		expect(settingsOpen).toBe(false);
	});

	it('dispatchDockAction search focuses without opening peel', () => {
		let focused = false;
		let peelOpened = false;
		const h: DockActionHandlers = {
			clearFilter: () => {},
			setFilter: () => {},
			openPeel: () => {
				peelOpened = true;
			},
			closePeel: () => {},
			getPeelOpen: () => false,
			getPeelMode: () => 'notes',
			setLinkedFocus: () => {},
			resolveLinkedFocus: () => null,
			newNote: () => {},
			focusSearch: () => {
				focused = true;
			},
			getSettingsOpen: () => false,
			openSettings: () => {},
			closeSettings: () => {}
		};
		dispatchDockAction('search', h);
		expect(focused).toBe(true);
		expect(peelOpened).toBe(false);
	});
});
