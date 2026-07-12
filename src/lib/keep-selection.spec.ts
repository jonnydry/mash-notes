import { describe, expect, it } from 'vitest';
import { keepSelectionToast, keepableNoteIds } from './keep-selection';
import type { Note } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id'>): Note {
	return {
		id: partial.id,
		title: partial.title ?? 'Note',
		body: partial.body ?? '',
		folder: partial.folder ?? '',
		tags: partial.tags ?? [],
		created: partial.created ?? 1,
		modified: partial.modified ?? 1,
		pinned: partial.pinned ?? 0,
		scope: partial.scope,
		sessionId: partial.sessionId,
		system: partial.system,
		deletedAt: partial.deletedAt
	};
}

describe('keep-selection', () => {
	it('picks only session-scoped selected notes', () => {
		const map = new Map<string, Note>([
			['a', note({ id: 'a', scope: 'session' })],
			['b', note({ id: 'b', scope: 'kept' })],
			['c', note({ id: 'c' })], // legacy / unset → keepable
			['d', note({ id: 'd', scope: 'session', system: 'welcome' })],
			['e', note({ id: 'e', scope: 'session', deletedAt: 9 })]
		]);
		expect(keepableNoteIds(['a', 'b', 'c', 'd', 'e', 'a', 'missing'], map)).toEqual(['a', 'c']);
	});

	it('toasts plainly', () => {
		expect(keepSelectionToast(0)).toBe('Nothing new to keep');
		expect(keepSelectionToast(1)).toBe('Kept 1 card on this device');
		expect(keepSelectionToast(3)).toBe('Kept 3 cards on this device');
	});
});
