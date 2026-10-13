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
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
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

	it('merges a desk bundle against stored notes, including tombstones and session ids', async () => {
		const now = Date.now();
		const day = 24 * 60 * 60 * 1000;
		await db.notes.bulkPut([
			{
				id: 'fresh',
				title: 'Fresh',
				body: 'stored newer',
				folder: '',
				tags: [],
				created: 1,
				modified: now,
				pinned: 0,
				sessionId: 'desk-a',
				scope: 'session'
			},
			{
				id: 'moved',
				title: 'Moved',
				body: 'local body',
				folder: '',
				tags: [],
				created: 1,
				modified: now - 2 * day,
				pinned: 0,
				sessionId: 'desk-a',
				scope: 'session'
			},
			{
				id: 'tomb',
				title: 'Tomb',
				body: 'gone',
				folder: '',
				tags: [],
				created: 1,
				modified: now - day,
				pinned: 0,
				deletedAt: now - day,
				sessionId: 'desk-a',
				scope: 'session'
			}
		]);
		const library = createNoteLibrary({
			flashToast: () => undefined,
			askConfirm: () => undefined,
			getActiveCanvasId: () => null,
			getActiveSessionId: () => 'desk-b',
			getActiveSessionMode: () => 'scratch',
			shouldSeedWelcome: () => false,
			onFolderDeleted: async () => undefined,
			getFilteredNoteIds: () => []
		});
		await library.loadNotes();

		const result = await library.importSyncText(
			JSON.stringify({
				version: 6,
				exportedAt: now,
				notes: [
					{
						id: 'fresh',
						title: 'Fresh',
						body: 'incoming older',
						folder: '',
						tags: [],
						created: 1,
						modified: now - day,
						pinned: 0
					},
					{
						id: 'moved',
						title: 'Moved',
						body: 'remote edit',
						folder: '',
						tags: [],
						created: 1,
						modified: now,
						pinned: 0
					},
					{
						id: 'tomb',
						title: 'Tomb',
						body: 'revived',
						folder: '',
						tags: [],
						created: 1,
						modified: now - 2 * day,
						pinned: 0
					}
				],
				tombstones: []
			})
		);

		expect(result.ok).toBe(true);
		expect(await db.notes.get('fresh')).toMatchObject({
			body: 'stored newer',
			sessionId: 'desk-a'
		});
		expect(await db.notes.get('moved')).toMatchObject({
			body: 'remote edit',
			sessionId: 'desk-a'
		});
		expect((await db.notes.get('tomb'))?.deletedAt).toBe(now - day);
		expect(library.notes.find((note) => note.id === 'tomb')).toBeUndefined();
		expect(library.notes.find((note) => note.id === 'fresh')?.sessionId).toBe('desk-a');
		expect(library.notes.find((note) => note.id === 'moved')?.sessionId).toBe('desk-a');
	});
});

describe('deleted notes are not written back', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	function libraryWithConfirm() {
		let action: (() => void | Promise<void>) | undefined;
		const library = createNoteLibrary({
			flashToast: () => undefined,
			askConfirm: (opts) => {
				action = opts.action;
			},
			getActiveCanvasId: () => null,
			shouldSeedWelcome: () => false,
			onFolderDeleted: async () => undefined,
			getFilteredNoteIds: () => []
		});
		return {
			library,
			confirm: () => Promise.resolve(action?.())
		};
	}

	it('keeps a deleted note deleted after tab hide and pagehide', async () => {
		const note = await createNote({ title: 'Stay', body: 'original' });
		const { library, confirm } = libraryWithConfirm();
		await library.loadNotes();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		library.selectNote(note.id);
		library.handleStickyBodyChange(note.id, 'typed then deleted');
		library.handleDelete();
		await confirm();

		vi.stubGlobal('document', { visibilityState: 'hidden' });
		library.handleVisibilityChange();
		library.flushPendingSave();
		await library.flushPendingSaveAsync();
		await vi.advanceTimersByTimeAsync(500);

		const stored = await db.notes.get(note.id);
		expect(stored?.deletedAt).toEqual(expect.any(Number));
		expect(stored?.body).toBe('original');
	});

	it('does not write a sticky save that was still inside the 400ms debounce when the note was deleted', async () => {
		const note = await createNote({ title: 'Stay', body: 'original' });
		const { library, confirm } = libraryWithConfirm();
		await library.loadNotes();
		const originalUpdate = db.notes.update.bind(db.notes);
		let updates = 0;
		db.notes.update = (async (...args: Parameters<typeof originalUpdate>) => {
			updates += 1;
			return originalUpdate(...args);
		}) as typeof db.notes.update;

		try {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
			library.selectNote(note.id);
			library.handleStickyBodyChange(note.id, 'quick edit');
			expect(updates).toBe(0);
			library.handleDelete();
			await confirm();
			await vi.advanceTimersByTimeAsync(500);

			expect(updates).toBe(0);
			const stored = await db.notes.get(note.id);
			expect(stored?.deletedAt).toEqual(expect.any(Number));
			expect(stored?.body).toBe('original');
		} finally {
			db.notes.update = originalUpdate;
		}
	});
});
