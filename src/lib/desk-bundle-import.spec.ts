import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { addNoteToCanvas, createNote, db, getOrCreateFolderCanvas } from './db';
import { createDeskBundleImport, DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE } from './desk-bundle-import';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

describe('desk bundle import button', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	afterEach(async () => {
		await db.delete();
	});

	it('shows Importing… and ignores a second click before the chunk resolves', async () => {
		let label = 'Import desk bundle…';
		let disabled = false;
		let loads = 0;
		let release: (value: unknown) => void = () => undefined;
		const start = createDeskBundleImport({
			loadChunk: () => {
				loads += 1;
				return new Promise((resolve) => {
					release = resolve;
				});
			},
			onBusy: () => {
				label = 'Importing…';
				disabled = true;
			},
			onIdle: () => {
				label = 'Import desk bundle…';
				disabled = false;
			},
			onOffline: () => undefined,
			onReady: () => undefined
		});

		const pending = start();
		expect(label).toBe('Importing…');
		expect(disabled).toBe(true);
		expect(loads).toBe(1);

		const second = start();
		expect(loads).toBe(1);

		release(undefined);
		await pending;
		await second;
		expect(disabled).toBe(false);
		expect(label).toBe('Import desk bundle…');
	});

	it('leaves the desk untouched when the import chunk fails to load', async () => {
		const note = await createNote({ title: 'Stay', body: 'put' });
		const canvas = await getOrCreateFolderCanvas('inbox');
		await addNoteToCanvas(canvas.id, note.id);
		let message = '';
		let ready = false;
		const start = createDeskBundleImport({
			loadChunk: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
			onBusy: () => undefined,
			onIdle: () => undefined,
			onOffline: (text) => {
				message = text;
			},
			onReady: () => {
				ready = true;
			}
		});

		await start();

		expect(ready).toBe(false);
		expect(message).toBe(DESK_BUNDLE_IMPORT_OFFLINE_MESSAGE);
		expect(await db.notes.get(note.id)).toMatchObject({ title: 'Stay', body: 'put' });
		expect(await db.canvasItems.count()).toBe(1);
		expect(await db.deskDeletions.count()).toBe(0);
	});
});
