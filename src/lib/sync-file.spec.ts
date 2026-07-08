import { describe, it, expect } from 'vitest';
import { buildSyncBundle, parseSyncBundle, mergeSyncBundle } from './sync-file';
import type { Note } from './types';

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

describe('sync-file', () => {
	it('round-trips a sync bundle', () => {
		const notes = [note({ id: 'a', title: 'A', body: 'hi', modified: 10 })];
		const bundle = buildSyncBundle(notes);
		const parsed = parseSyncBundle(JSON.stringify(bundle));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.notes[0].title).toBe('A');
	});

	it('merges remote updates and reports conflicts', () => {
		const local = [
			note({ id: 'a', title: 'Local', body: 'L', modified: 5 }),
			note({ id: 'b', title: 'Only local', modified: 3 })
		];
		const remote = buildSyncBundle([
			note({ id: 'a', title: 'Remote', body: 'R', modified: 9 }),
			note({ id: 'c', title: 'New remote', modified: 8 })
		]);
		const { notes, summary } = mergeSyncBundle(local, remote);
		expect(summary.added).toBe(1);
		expect(summary.updated).toBe(1);
		expect(notes.find((n) => n.id === 'a')?.body).toBe('R');
		expect(notes.find((n) => n.id === 'c')?.title).toBe('New remote');
		expect(notes.find((n) => n.id === 'b')).toBeTruthy();
	});

	it('rejects bad JSON and invalid notes', () => {
		expect(parseSyncBundle('nope').ok).toBe(false);
		expect(parseSyncBundle(JSON.stringify({ version: 1, notes: [null] })).ok).toBe(false);
		expect(
			parseSyncBundle(JSON.stringify({ version: 1, notes: ['not-an-object'] })).ok
		).toBe(false);
	});
});
