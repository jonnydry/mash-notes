import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill indexedDB BEFORE importing db.ts (which opens Dexie at module level)
import 'fake-indexeddb/auto';

// Polyfill crypto.randomUUID for older Node test environments
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.randomUUID) {
	// @ts-ignore — polyfill only randomUUID, don't replace entire crypto object
	globalThis.crypto.randomUUID = (webcrypto.randomUUID as any).bind(webcrypto);
}

import { db, createNote, updateNote, deleteNote } from './db';
import {
	initSearchIndex,
	addNoteToSearch,
	updateNoteInSearch,
	removeNoteFromSearch,
	searchNotes,
	getSearchIndexSize,
	resetSearchIndexForTests,
} from './search';

describe('MASH sync engine — DB ↔ search lifecycle', () => {
	beforeEach(async () => {
		// Clear Dexie table (don't delete/recreate — singleton stays intact)
		await db.notes.clear();
		// Reset MiniSearch singleton + allow re-init
		resetSearchIndexForTests();
		// Re-hydrate search index from (now-empty) DB
		await initSearchIndex();
	});

	it('creates a note and makes it searchable', async () => {
		// createNote writes to DB only — UI must also add to search
		const note = await createNote({ title: 'Project Ideas', body: 'Build the thing', tags: ['idea'] });
		addNoteToSearch(note);

		expect(getSearchIndexSize()).toBe(1);

		const results = searchNotes('Build');
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(note.id);
		expect(results[0].title).toBe('Project Ideas');
	});

	it('updates a note and reflects the change immediately (no stale data)', async () => {
		const note = await createNote({ title: 'Draft', body: 'first version' });
		addNoteToSearch(note);

		// Update both DB and search (UI orchestration pattern)
		const updated = await updateNote(note.id, { body: 'second version' });
		updateNoteInSearch({ id: note.id, body: 'second version' }, updated);

		// New content is searchable immediately
		const results = searchNotes('second');
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(note.id);

		// Old content is purged — no stale data
		const staleResults = searchNotes('first');
		expect(staleResults).toHaveLength(0);
	});

	it('deletes a note and purges it from search', async () => {
		const note = await createNote({ title: 'Delete me', body: 'temporary content' });
		addNoteToSearch(note);

		expect(getSearchIndexSize()).toBe(1);

		// Delete from both DB and search (UI orchestration pattern)
		await deleteNote(note.id);
		removeNoteFromSearch(note.id);

		expect(getSearchIndexSize()).toBe(0);
		expect(searchNotes('temporary')).toHaveLength(0);
	});

	it('handles multiple notes and searches across all of them', async () => {
		const n1 = await createNote({ title: 'Alpha', body: 'first note about cats' });
		addNoteToSearch(n1);
		const n2 = await createNote({ title: 'Beta', body: 'second note about dogs' });
		addNoteToSearch(n2);
		const n3 = await createNote({ title: 'Gamma', body: 'third note about birds' });
		addNoteToSearch(n3);

		expect(getSearchIndexSize()).toBe(3);

		// Title search (boosted)
		const titleResults = searchNotes('Alpha');
		expect(titleResults).toHaveLength(1);
		expect(titleResults[0].id).toBe(n1.id);

		// Body search across multiple notes
		const noteResults = searchNotes('note');
		expect(noteResults).toHaveLength(3);

		// Prefix search
		const prefixResults = searchNotes('dog');
		expect(prefixResults).toHaveLength(1);
		expect(prefixResults[0].id).toBe(n2.id);
	});

	it('initSearchIndex hydrates from DB on startup', async () => {
		// Create notes directly in DB (bypassing search)
		const n1 = await createNote({ title: 'Stored Note', body: 'persisted in IndexedDB' });
		const n2 = await createNote({ title: 'Another', body: 'completely different content' });

		// Reset search and re-init — should pick up all DB notes
		resetSearchIndexForTests();
		await initSearchIndex();

		expect(getSearchIndexSize()).toBe(2);

		const results = searchNotes('persisted');
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(n1.id);
	});
});