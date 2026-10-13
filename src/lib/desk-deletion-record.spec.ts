import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import {
	addCanvasEdge,
	addCanvasElement,
	addNoteToCanvas,
	createNote,
	db,
	getOrCreateFolderCanvas,
	removeCanvasEdge,
	removeCanvasElement,
	removeCanvasItem
} from './db';
import { buildSyncBundle } from './sync-file';

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

	it('exports a card, link, and arrow deleted before any desk bundle import', async () => {
		const noteA = await createNote({ title: 'A', body: 'card' });
		const noteB = await createNote({ title: 'B', body: 'kept' });
		const canvas = await getOrCreateFolderCanvas('inbox');
		const itemA = await addNoteToCanvas(canvas.id, noteA.id);
		const itemB = await addNoteToCanvas(canvas.id, noteB.id);
		const edge = await addCanvasEdge(canvas.id, itemA.id, itemB.id);
		const arrow = await addCanvasElement({
			id: 'arrow-1',
			canvasId: canvas.id,
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: itemB.id, anchor: 'right' },
			end: { type: 'point', x: 12, y: 24 },
			zIndex: 1,
			created: 1,
			modified: 1
		});

		await removeCanvasEdge(edge.id);
		await removeCanvasElement(arrow.id);
		await removeCanvasItem(itemA.id);

		const exported = await buildSyncBundle([noteA, noteB]);
		expect(exported.desk?.deletions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'item', canvasId: canvas.id, noteId: noteA.id }),
				expect.objectContaining({
					kind: 'edge',
					canvasId: canvas.id,
					fromNoteId: noteA.id,
					toNoteId: noteB.id
				}),
				expect.objectContaining({ kind: 'element', canvasId: canvas.id })
			])
		);
		expect(await db.canvasItems.where('noteId').equals(noteA.id).count()).toBe(0);
	});
});
