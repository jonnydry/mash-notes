import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

vi.mock('$lib/sync-file', () => {
	throw new Error('Failed to fetch dynamically imported module');
});

import { createNote, db } from '$lib/db';
import { DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE } from '$lib/desk-bundle-import';
import { createNoteLibrary } from '$lib/stores/note-library.svelte';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

describe('desk bundle import without the chunk', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('reports the offline message and does not change stored notes', async () => {
		const note = await createNote({ title: 'Stay', body: 'put' });
		let toast = '';
		const library = createNoteLibrary({
			flashToast: (message) => {
				toast = message;
			},
			askConfirm: () => undefined,
			getActiveCanvasId: () => null,
			shouldSeedWelcome: () => false,
			onFolderDeleted: async () => undefined,
			getFilteredNoteIds: () => []
		});
		await library.loadNotes();

		const result = await library.importSyncText('{"version":6,"notes":[]}');

		expect(result).toEqual({ ok: false, message: DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE });
		expect(toast).toBe(DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE);
		expect(await db.notes.get(note.id)).toMatchObject({ title: 'Stay', body: 'put' });
	});
});
