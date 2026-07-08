import { describe, it, expect } from 'vitest';
import { mergeNotesLww, hasConflicts } from './sync-model';
import type { Note } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id' | 'modified'>): Note {
	return {
		title: 'T',
		body: '',
		folder: '',
		tags: [],
		created: 1,
		pinned: 0,
		...partial
	};
}

describe('sync-model', () => {
	it('takes remote body when remote is newer', () => {
		const local = note({ id: 'a', body: 'local', modified: 10 });
		const remote = note({ id: 'a', body: 'remote', modified: 20 });
		const result = mergeNotesLww(local, remote);
		expect(result.note.body).toBe('remote');
		expect(hasConflicts(result)).toBe(true);
	});

	it('unions tags on concurrent edits', () => {
		const base = note({ id: 'a', tags: ['a'], modified: 5 });
		const local = note({ id: 'a', tags: ['a', 'b'], modified: 10 });
		const remote = note({ id: 'a', tags: ['a', 'c'], modified: 10 });
		const result = mergeNotesLww(local, remote, base);
		expect(result.note.tags.sort()).toEqual(['a', 'b', 'c']);
	});

	it('keeps local when only local changed from base', () => {
		const base = note({ id: 'a', title: 'Base', modified: 5 });
		const local = note({ id: 'a', title: 'Local', modified: 10 });
		const remote = note({ id: 'a', title: 'Base', modified: 6 });
		const result = mergeNotesLww(local, remote, base);
		expect(result.note.title).toBe('Local');
	});
});
