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
			expect(updateCalls).toBe(1);
			expect(library.notesById.get(note.id)?.body).toBe('typed while debouncing');

			// A hidden/visible flip, plus pagehide, must not start a second write.
			life.show();
			life.hide();
			life.pageHide();
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
			expect(updateCalls).toBe(1);

			life.hide();
			life.show();
			life.pageHide();
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
});
