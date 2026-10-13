import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import {
	addNoteToCanvas,
	createNote,
	db,
	getOrCreateFolderCanvas,
	removeCanvasItem
} from '$lib/db';
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

		// Dropping the note from the shelf is not the guard. A hide flush that
		// can still see the row must not write the pending edit over the tombstone.
		library.notes = [
			...library.notes,
			{ ...note, body: 'typed then deleted', modified: Date.now() }
		];

		vi.stubGlobal('document', { visibilityState: 'hidden' });
		library.handleVisibilityChange();
		library.flushPendingSave();
		await library.flushPendingSaveAsync();
		await vi.advanceTimersByTimeAsync(500);

		const stored = await db.notes.get(note.id);
		expect(stored?.deletedAt).toEqual(expect.any(Number));
		expect(stored?.body).toBe('original');
		expect(stored!.modified).toBeLessThanOrEqual(stored!.deletedAt!);
	});

	it('saves a later edit after the card is only removed from the canvas', async () => {
		const note = await createNote({ title: 'Stay', body: 'original' });
		const canvas = await getOrCreateFolderCanvas('');
		const item = await addNoteToCanvas(canvas.id, note.id);
		await removeCanvasItem(item.id);
		const { library } = libraryWithConfirm();
		await library.loadNotes();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		const originalUpdate = db.notes.update.bind(db.notes);
		let saved = Promise.resolve();
		db.notes.update = (async (...args: Parameters<typeof originalUpdate>) => {
			const result = originalUpdate(...args);
			saved = result.then(() => undefined);
			return result;
		}) as typeof db.notes.update;

		try {
			library.selectNote(note.id);
			library.handleStickyBodyChange(note.id, 'edited off the desk');

			vi.stubGlobal('document', { visibilityState: 'hidden' });
			library.handleVisibilityChange();
			await vi.advanceTimersByTimeAsync(500);
			await saved;

			const stored = await db.notes.get(note.id);
			expect(stored?.deletedAt).toBeUndefined();
			expect(stored?.body).toBe('edited off the desk');
		} finally {
			db.notes.update = originalUpdate;
		}
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

type LifecycleListener = (event: Event) => void;

/** Minimal document/window so the library can observe hide and pagehide. */
function installPageLifecycle() {
	let visibilityState: DocumentVisibilityState = 'visible';
	const visibilityListeners = new Set<LifecycleListener>();
	const pageHideListeners = new Set<LifecycleListener>();
	vi.stubGlobal('document', {
		get visibilityState() {
			return visibilityState;
		},
		addEventListener(type: string, listener: LifecycleListener) {
			if (type === 'visibilitychange') visibilityListeners.add(listener);
		},
		removeEventListener(type: string, listener: LifecycleListener) {
			if (type === 'visibilitychange') visibilityListeners.delete(listener);
		}
	});
	vi.stubGlobal('window', {
		addEventListener(type: string, listener: LifecycleListener) {
			if (type === 'pagehide') pageHideListeners.add(listener);
		},
		removeEventListener(type: string, listener: LifecycleListener) {
			if (type === 'pagehide') pageHideListeners.delete(listener);
		}
	});
	return {
		hide() {
			visibilityState = 'hidden';
			for (const listener of visibilityListeners) listener(new Event('visibilitychange'));
		},
		show() {
			visibilityState = 'visible';
			for (const listener of visibilityListeners) listener(new Event('visibilitychange'));
		},
		pageHide() {
			for (const listener of pageHideListeners) listener(new Event('pagehide'));
		}
	};
}

function libraryForTests() {
	return createNoteLibrary({
		flashToast: () => undefined,
		askConfirm: () => undefined,
		getActiveCanvasId: () => null,
		shouldSeedWelcome: () => false,
		onFolderDeleted: async () => undefined,
		getFilteredNoteIds: () => []
	});
}

describe('note library sticky save on hide', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('persists a pending edit when the tab hides before the debounce fires', async () => {
		const note = await createNote({ title: 'Draft', body: 'before' });
		const life = installPageLifecycle();
		const library = libraryForTests();
		await library.loadNotes();
		const originalUpdate = db.notes.update.bind(db.notes);
		let updateCalls = 0;
		let releaseDelayedWrite: () => void = () => undefined;
		const delayedWrite = new Promise<void>((resolve) => {
			releaseDelayedWrite = resolve;
		});
		let pendingWrite: Promise<unknown> = Promise.resolve();
		db.notes.update = (async (...args: Parameters<typeof originalUpdate>) => {
			const id = args[0];
			if (id !== note.id) return originalUpdate(...args);
			updateCalls += 1;
			pendingWrite = delayedWrite.then(() => originalUpdate(...args));
			return pendingWrite;
		}) as unknown as typeof db.notes.update;

		try {
			expect((await db.notes.get(note.id))?.body).toBe('before');
			vi.useFakeTimers();
			library.handleStickyBodyChange(note.id, 'typed while debouncing');
			expect(updateCalls).toBe(0);

			life.hide();
			library.handleVisibilityChange();
			expect(updateCalls).toBe(1);
			expect(library.notesById.get(note.id)?.body).toBe('typed while debouncing');

			// A hidden/visible flip, plus pagehide, must not start a second write.
			life.show();
			library.handleVisibilityChange();
			life.hide();
			library.handleVisibilityChange();
			life.pageHide();
			library.flushPendingSave();
			expect(updateCalls).toBe(1);
			expect(library.notesById.get(note.id)?.body).toBe('typed while debouncing');

			await vi.advanceTimersByTimeAsync(1_000);
			expect(updateCalls).toBe(1);

			vi.useRealTimers();
			releaseDelayedWrite();
			await pendingWrite;
			expect((await db.notes.get(note.id))?.body).toBe('typed while debouncing');
			expect(library.notesById.get(note.id)?.body).toBe('typed while debouncing');
			expect(library.writeError).toBe('');
		} finally {
			db.notes.update = originalUpdate as unknown as typeof db.notes.update;
		}
	});

	it('persists a pending edit on pagehide when visibilitychange never fires', async () => {
		const note = await createNote({ title: 'Draft', body: 'before' });
		const life = installPageLifecycle();
		const library = libraryForTests();
		await library.loadNotes();
		const originalUpdate = db.notes.update.bind(db.notes);
		let updateCalls = 0;
		let releaseDelayedWrite: () => void = () => undefined;
		const delayedWrite = new Promise<void>((resolve) => {
			releaseDelayedWrite = resolve;
		});
		let pendingWrite: Promise<unknown> = Promise.resolve();
		db.notes.update = (async (...args: Parameters<typeof originalUpdate>) => {
			const id = args[0];
			if (id !== note.id) return originalUpdate(...args);
			updateCalls += 1;
			pendingWrite = delayedWrite.then(() => originalUpdate(...args));
			return pendingWrite;
		}) as unknown as typeof db.notes.update;

		try {
			vi.useFakeTimers();
			library.handleStickyBodyChange(note.id, 'still pending at pagehide');
			expect(updateCalls).toBe(0);

			life.pageHide();
			library.flushPendingSave();
			expect(updateCalls).toBe(1);

			life.hide();
			library.handleVisibilityChange();
			life.show();
			library.handleVisibilityChange();
			life.pageHide();
			library.flushPendingSave();
			expect(updateCalls).toBe(1);
			expect(library.notesById.get(note.id)?.body).toBe('still pending at pagehide');

			await vi.advanceTimersByTimeAsync(1_000);
			expect(updateCalls).toBe(1);

			vi.useRealTimers();
			releaseDelayedWrite();
			await pendingWrite;
			expect((await db.notes.get(note.id))?.body).toBe('still pending at pagehide');
			expect(library.writeError).toBe('');
		} finally {
			db.notes.update = originalUpdate as unknown as typeof db.notes.update;
		}
	});

	it('does not write again on a second pagehide', async () => {
		const note = await createNote({ title: 'Draft', body: 'before' });
		const life = installPageLifecycle();
		const library = libraryForTests();
		await library.loadNotes();
		window.addEventListener('pagehide', library.flushPendingSave);
		const originalUpdate = db.notes.update.bind(db.notes);
		let updateCalls = 0;
		let releaseDelayedWrite: () => void = () => undefined;
		const delayedWrite = new Promise<void>((resolve) => {
			releaseDelayedWrite = resolve;
		});
		let pendingWrite: Promise<unknown> = Promise.resolve();
		db.notes.update = (async (...args: Parameters<typeof originalUpdate>) => {
			const id = args[0];
			if (id !== note.id) return originalUpdate(...args);
			updateCalls += 1;
			pendingWrite = delayedWrite.then(() => originalUpdate(...args));
			return pendingWrite;
		}) as unknown as typeof db.notes.update;

		try {
			vi.useFakeTimers();
			library.handleStickyBodyChange(note.id, 'once');
			life.pageHide();
			expect(updateCalls).toBe(1);

			life.pageHide();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(updateCalls).toBe(1);

			vi.useRealTimers();
			releaseDelayedWrite();
			await pendingWrite;
			expect((await db.notes.get(note.id))?.body).toBe('once');

			life.pageHide();
			expect(updateCalls).toBe(1);
			expect((await db.notes.get(note.id))?.body).toBe('once');
			expect(library.notesById.get(note.id)?.body).toBe('once');
		} finally {
			db.notes.update = originalUpdate as unknown as typeof db.notes.update;
		}
	});

	it('saves an edit made after a flush', async () => {
		const note = await createNote({ title: 'Draft', body: 'before' });
		const library = libraryForTests();
		await library.loadNotes();

		vi.useFakeTimers();
		library.handleStickyBodyChange(note.id, 'flushed');
		const flushed = library.flushPendingSaveAsync();
		vi.useRealTimers();
		await flushed;
		expect((await db.notes.get(note.id))?.body).toBe('flushed');

		vi.useFakeTimers();
		library.handleStickyBodyChange(note.id, 'edited after flush');
		const debounced = vi.advanceTimersByTimeAsync(450);
		vi.useRealTimers();
		await debounced;
		expect(library.notesById.get(note.id)?.body).toBe('edited after flush');
		expect((await db.notes.get(note.id))?.body).toBe('edited after flush');
		expect(library.writeError).toBe('');
	});

	it('keeps a newer edit when an in-flight flush fails', async () => {
		const note = await createNote({ title: 'Draft', body: 'before' });
		const library = libraryForTests();
		await library.loadNotes();
		const originalUpdate = db.notes.update.bind(db.notes);
		db.notes.update = (async () => {
			throw new Error('Quota exceeded');
		}) as unknown as typeof db.notes.update;

		try {
			vi.useFakeTimers();
			library.handleStickyBodyChange(note.id, 'stale');
			library.flushPendingSave();
			library.handleStickyBodyChange(note.id, 'fresh');
			await vi.advanceTimersByTimeAsync(0);
			expect(library.notesById.get(note.id)?.body).toBe('fresh');
			expect(library.writeError).toMatch(/could not save/i);

			vi.useRealTimers();
			db.notes.update = originalUpdate as unknown as typeof db.notes.update;
			await library.flushPendingSaveAsync();
			expect(library.writeError).toBe('');
			expect(library.notesById.get(note.id)?.body).toBe('fresh');
			expect((await db.notes.get(note.id))?.body).toBe('fresh');
		} finally {
			db.notes.update = originalUpdate as unknown as typeof db.notes.update;
		}
	});
});
