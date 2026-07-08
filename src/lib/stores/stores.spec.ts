import { describe, it, expect } from 'vitest';
import { cardDisplaySize, computeExpandBumps, COLLAPSED_CARD, EXPANDED_CARD } from './canvas-session';
import { peelTitleFor, peelOpenPatch, windowPeelNotes, PEEL_UI_CAP } from './peel-nav';
import { filterPeelNotes, uniqueFoldersFrom, canvasFolderFromFilter } from './note-library';
import type { Note } from '$lib/types';

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
		expect(peelOpenPatch('folders').foldersFlyout).toBe(true);
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
	});
});
