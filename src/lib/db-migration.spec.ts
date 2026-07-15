import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';

const DB_NAME = 'mashdb-notes-v1';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

async function createLegacyV9Database() {
	await db.close();
	await db.delete();
	// Dexie maps declared version 9 to native IndexedDB version 90.
	const request = indexedDB.open(DB_NAME, 90);
	request.onupgradeneeded = () => {
		const database = request.result;
		const notes = database.createObjectStore('notes', { keyPath: 'id' });
		for (const key of [
			'modified',
			'folder',
			'pinned',
			'deletedAt',
			'sessionId',
			'scope',
			'operationId'
		])
			notes.createIndex(key, key);
		notes.createIndex('tags', 'tags', { multiEntry: true });
		const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
		for (const key of [
			'mode',
			'status',
			'modified',
			'lastMeaningfulActivityAt',
			'expiresAt',
			'recoveryUntil'
		])
			sessions.createIndex(key, key);
		const canvases = database.createObjectStore('canvases', { keyPath: 'id' });
		for (const key of ['sessionId', 'folder', 'modified']) canvases.createIndex(key, key);
		canvases.createIndex('[sessionId+folder]', ['sessionId', 'folder'], { unique: true });
		const items = database.createObjectStore('canvasItems', { keyPath: 'id' });
		items.createIndex('canvasId', 'canvasId');
		items.createIndex('noteId', 'noteId');
		items.createIndex('[canvasId+noteId]', ['canvasId', 'noteId'], { unique: true });
		const edges = database.createObjectStore('canvasEdges', { keyPath: 'id' });
		for (const key of ['canvasId', 'fromItemId', 'toItemId']) edges.createIndex(key, key);
		edges.createIndex('[canvasId+fromItemId+toItemId]', ['canvasId', 'fromItemId', 'toItemId'], {
			unique: true
		});
		const operations = database.createObjectStore('operations', { keyPath: 'id' });
		for (const key of ['sessionId', 'type', 'created', 'revertedAt'])
			operations.createIndex(key, key);
		operations.createIndex('inputNoteIds', 'inputNoteIds', { multiEntry: true });
		operations.createIndex('outputNoteIds', 'outputNoteIds', { multiEntry: true });
		const blobs = database.createObjectStore('noteBlobs', { keyPath: 'id' });
		blobs.createIndex('created', 'created');
		blobs.createIndex('mime', 'mime');
	};
	const legacy = await requestResult(request);
	const transaction = legacy.transaction(['canvases', 'canvasItems'], 'readwrite');
	transaction.objectStore('canvases').put({
		id: 'legacy-canvas',
		folder: '',
		title: 'Legacy desk',
		created: 1,
		modified: 1,
		sessionId: 'legacy-session'
	});
	transaction.objectStore('canvasItems').put({
		id: 'legacy-item',
		canvasId: 'legacy-canvas',
		noteId: 'legacy-note',
		x: 12,
		y: 34,
		w: 220,
		h: 120
	});
	await transactionDone(transaction);
	legacy.close();
}

describe('database v10 migration', () => {
	afterEach(async () => {
		await db.delete();
		await db.open();
	});

	it('adds canvasElements without changing existing canvas placements', async () => {
		await createLegacyV9Database();
		await db.open();

		expect(db.verno).toBe(10);
		expect(await db.canvasItems.get('legacy-item')).toMatchObject({
			canvasId: 'legacy-canvas',
			noteId: 'legacy-note',
			x: 12,
			y: 34
		});
		expect(await db.canvasElements.count()).toBe(0);
		await db.canvasElements.add({
			id: 'new-arrow',
			canvasId: 'legacy-canvas',
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: 'legacy-item', anchor: 'right' },
			end: { type: 'point', x: 320, y: 100 },
			zIndex: 1,
			created: 2,
			modified: 2
		});
		expect(await db.canvasElements.get('new-arrow')).toMatchObject({ kind: 'arrow' });
	});
});
