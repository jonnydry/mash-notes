import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

import {
	db,
	createNote,
	getOrCreateFolderCanvas,
	getCanvasItems,
	addNoteToCanvas,
	updateCanvasBowls,
	updateCanvasItemPosition,
	removeCanvasItem,
	deleteNote
} from './db';

describe('Canvas DB', () => {
	beforeEach(async () => {
		await db.notes.clear();
		await db.canvases.clear();
		await db.canvasItems.clear();
	});

	it('creates one canvas per folder and reuses it', async () => {
		const a = await getOrCreateFolderCanvas('Ideas');
		const b = await getOrCreateFolderCanvas('Ideas');
		expect(a.id).toBe(b.id);
		expect(a.folder).toBe('Ideas');
	});

	it('adds notes as cards without duplicating', async () => {
		const note = await createNote({ title: 'Card', folder: 'Ideas' });
		const canvas = await getOrCreateFolderCanvas('Ideas');
		const first = await addNoteToCanvas(canvas.id, note.id);
		const second = await addNoteToCanvas(canvas.id, note.id);
		expect(first.id).toBe(second.id);
		const items = await getCanvasItems(canvas.id);
		expect(items).toHaveLength(1);
	});

	it('rejects concurrent duplicate placements via unique index', async () => {
		const note = await createNote({ title: 'Race', folder: 'Ideas' });
		const canvas = await getOrCreateFolderCanvas('Ideas');
		const [a, b] = await Promise.all([
			addNoteToCanvas(canvas.id, note.id, { x: 0, y: 0 }),
			addNoteToCanvas(canvas.id, note.id, { x: 50, y: 50 })
		]);
		expect(a.id).toBe(b.id);
		expect(await getCanvasItems(canvas.id)).toHaveLength(1);
	});

	it('updates card position and removes cards', async () => {
		const note = await createNote({ title: 'Move me', folder: 'Ideas' });
		const canvas = await getOrCreateFolderCanvas('Ideas');
		const item = await addNoteToCanvas(canvas.id, note.id, { x: 10, y: 20 });
		await updateCanvasItemPosition(item.id, { x: 100, y: 200 });
		const updated = (await getCanvasItems(canvas.id))[0];
		expect(updated.x).toBe(100);
		expect(updated.y).toBe(200);
		await removeCanvasItem(item.id);
		expect(await getCanvasItems(canvas.id)).toHaveLength(0);
	});

	it('persists bowl membership on the canvas', async () => {
		const first = await createNote({ title: 'First', folder: 'Ideas' });
		const second = await createNote({ title: 'Second', folder: 'Ideas' });
		const canvas = await getOrCreateFolderCanvas('Ideas');
		const firstItem = await addNoteToCanvas(canvas.id, first.id);
		const secondItem = await addNoteToCanvas(canvas.id, second.id);
		const bowl = {
			id: crypto.randomUUID(),
			name: 'Research',
			itemIds: [firstItem.id, secondItem.id],
			created: Date.now(),
			modified: Date.now()
		};

		await updateCanvasBowls(canvas.id, [bowl]);

		const stored = await db.canvases.get(canvas.id);
		expect(stored?.bowls).toEqual([bowl]);
	});

	it('clears canvas items when a note is deleted', async () => {
		const note = await createNote({ title: 'Gone', folder: 'Ideas' });
		const canvas = await getOrCreateFolderCanvas('Ideas');
		await addNoteToCanvas(canvas.id, note.id);
		await deleteNote(note.id);
		expect(await getCanvasItems(canvas.id)).toHaveLength(0);
	});
});
