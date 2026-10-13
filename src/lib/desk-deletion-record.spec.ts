import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { addNoteToCanvas, createNote, db, getOrCreateFolderCanvas, removeCanvasItem } from './db';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

describe('desk delete markers stay out of the first load', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('removes a card without writing a marker before any desk bundle import', async () => {
		const note = await createNote({ title: 'Card', body: 'local' });
		const canvas = await getOrCreateFolderCanvas('inbox');
		const item = await addNoteToCanvas(canvas.id, note.id);

		await removeCanvasItem(item.id);

		expect(await db.canvasItems.count()).toBe(0);
		expect(await db.deskDeletions.toArray()).toEqual([]);
	});
});
