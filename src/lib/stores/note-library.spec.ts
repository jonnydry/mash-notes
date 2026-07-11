import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { createNote, db } from '$lib/db';
import { createNoteLibrary } from './note-library.svelte';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

describe('note library write recovery', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	afterEach(() => vi.useRealTimers());

	it('keeps an edit in memory and retries it after a storage write failure', async () => {
		const note = await createNote({ title: 'Draft', body: 'before' });
		const library = createNoteLibrary({
			flashToast: () => undefined,
			askConfirm: () => undefined,
			getActiveCanvasId: () => null,
			shouldSeedWelcome: () => false,
			onFolderDeleted: async () => undefined,
			getFilteredNoteIds: () => []
		});
		await library.loadNotes();
		vi.useFakeTimers();
		const originalUpdate = db.notes.update.bind(db.notes);
		db.notes.update = (async () => {
			throw new Error('Quota exceeded');
		}) as unknown as typeof db.notes.update;

		library.handleStickyBodyChange(note.id, 'still in memory');
		await vi.advanceTimersByTimeAsync(450);
		expect(library.notesById.get(note.id)?.body).toBe('still in memory');
		expect(library.writeError).toMatch(/could not save/i);

		vi.useRealTimers();
		db.notes.update = originalUpdate;
		await library.retryPendingWrites();
		expect(library.writeError).toBe('');
		expect((await db.notes.get(note.id))?.body).toBe('still in memory');
	});
});
