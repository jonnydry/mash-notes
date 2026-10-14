import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { addNoteToCanvas, createNote, db, getOrCreateFolderCanvas } from '$lib/db';
import { createCanvasSession } from './canvas-session.svelte';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

describe('canvas session undo', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('keeps the stored modified on session cards after undoing a removed duplicate', async () => {
		const notes = [
			await createNote({ title: 'Same', body: 'text' }),
			await createNote({ title: 'Same', body: 'text' })
		];
		const notesById = new Map(notes.map((note) => [note.id, note]));
		const canvas = await getOrCreateFolderCanvas('');
		await addNoteToCanvas(canvas.id, notes[0].id, { x: 0, y: 0 });
		await addNoteToCanvas(canvas.id, notes[1].id, { x: 400, y: 0 });

		const session = createCanvasSession({
			flashToast: () => undefined,
			getNotes: () => notes,
			getNotesById: () => notesById,
			getCanvasKey: () => '',
			getSelectionIds: () => [],
			getSelectionSet: () => new Set(),
			getSelectedId: () => null,
			setSelection: () => undefined,
			selectNote: () => undefined,
			toggleSelection: () => undefined,
			deleteBlankNote: async () => undefined,
			removeNoteFromSearch: () => undefined,
			removeNoteFromLibrary: () => undefined
		});

		await session.loadContextCanvas('');
		expect(session.canvasItems).toHaveLength(2);
		const modifiedBefore = new Map(session.canvasItems.map((item) => [item.id, item.modified]));

		const removed = await session.deduplicateCanvasSelection(
			notes.map((note) => note.id),
			notesById
		);
		expect(removed.removed).toBe(1);
		const keptIds = new Set(session.canvasItems.map((item) => item.id));
		const removedId = [...modifiedBefore.keys()].find((id) => !keptIds.has(id));
		expect(removedId).toBeTruthy();

		await session.undoCanvasLayout();

		// Session cards, not IndexedDB. The database stamp already exists on main;
		// this fails when undo puts the pre-delete snapshot back into canvasItems.
		const restored = session.canvasItems.find((item) => item.id === removedId);
		expect(restored?.modified).toBeGreaterThan(modifiedBefore.get(removedId!)!);
	});
});
