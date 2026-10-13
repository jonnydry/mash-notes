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

describe('desk delete markers on the first load', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('records a card delete marker before any desk bundle import', async () => {
		const note = await createNote({ title: 'Card', body: 'local' });
		const canvas = await getOrCreateFolderCanvas('inbox');
		const item = await addNoteToCanvas(canvas.id, note.id);

		await removeCanvasItem(item.id);

		const markers = await db.deskDeletions.toArray();
		expect(markers).toHaveLength(1);
		expect(markers[0]).toMatchObject({
			kind: 'item',
			canvasId: canvas.id,
			noteId: note.id
		});
		expect(markers[0]?.deletedAt).toBeGreaterThan(0);
		expect(await db.canvasItems.count()).toBe(0);
	});
});
