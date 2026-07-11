import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import {
	KEPT_COLLECTION_SESSION_ID,
	createNote,
	createOperationRecord,
	db,
	deleteSessionPermanently,
	getActiveNotes,
	getOrCreateFolderCanvas,
	setOperationReverted
} from '$lib/db';
import { DAY_MS } from '$lib/session-lifecycle';
import { createSessionManager } from './sessions.svelte';

if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis.crypto, 'randomUUID', {
		value: webcrypto.randomUUID.bind(webcrypto),
		configurable: true
	});
}

class MemoryStorage {
	private values = new Map<string, string>();
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.values.set(key, String(value));
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	clear() {
		this.values.clear();
	}
}

Object.defineProperty(globalThis, 'localStorage', {
	value: new MemoryStorage(),
	configurable: true
});

describe('session manager', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		localStorage.clear();
	});

	it('creates an expiring scratch desk on a fresh database', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(10 * DAY_MS);

		expect(manager.activeSession?.mode).toBe('scratch');
		expect(manager.activeSession?.status).toBe('active');
		expect(manager.activeSession?.expiresAt).toBe(24 * DAY_MS);
	});

	it('keeps the desk and all of its notes indefinitely', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const sessionId = manager.activeSession!.id;
		const note = await createNote({
			title: 'Keep me',
			sessionId,
			scope: 'session'
		});

		await manager.keepActive(2 * DAY_MS);

		expect(manager.activeSession?.mode).toBe('kept');
		expect(manager.activeSession?.expiresAt).toBeUndefined();
		expect((await db.notes.get(note.id))?.scope).toBe('kept');
	});

	it('keeps a takeaway globally and preserves its operation when scratch recovery expires', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const scratchId = manager.activeSession!.id;
		const keptNote = await createNote({
			title: 'Keep this result',
			sessionId: scratchId,
			scope: 'session'
		});
		const temporaryNote = await createNote({
			title: 'Temporary ingredient',
			sessionId: scratchId,
			scope: 'session'
		});
		const operation = await createOperationRecord({
			sessionId: scratchId,
			type: 'mash',
			inputNoteIds: [temporaryNote.id],
			outputNoteIds: [keptNote.id]
		});
		await db.notes.update(keptNote.id, { operationId: operation.id });

		const promoted = await manager.keepTakeaway([keptNote.id, 'missing'], 2 * DAY_MS);
		expect(promoted.map((note) => note.id)).toEqual([keptNote.id]);
		expect(await db.sessions.get(KEPT_COLLECTION_SESSION_ID)).toMatchObject({
			mode: 'kept',
			status: 'active'
		});
		expect((await db.notes.get(keptNote.id))?.scope).toBe('kept');
		expect((await getActiveNotes({ keptCollection: true })).map((note) => note.id)).toContain(
			keptNote.id
		);

		await manager.clearActive(3 * DAY_MS);
		expect(await manager.purgePermanentlyExpired(11 * DAY_MS)).toBe(1);
		expect(await db.notes.get(temporaryNote.id)).toBeUndefined();
		expect(await db.notes.get(keptNote.id)).toMatchObject({
			sessionId: KEPT_COLLECTION_SESSION_ID,
			scope: 'kept'
		});
		expect(await db.operations.get(operation.id)).toMatchObject({
			sessionId: KEPT_COLLECTION_SESSION_ID
		});
	});

	it('rolls back the kept collection when takeaway persistence fails', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const note = await createNote({
			title: 'Still scratch',
			sessionId: manager.activeSession!.id,
			scope: 'session'
		});
		const bulkPut = vi.spyOn(db.notes, 'bulkPut').mockRejectedValueOnce(new Error('quota full'));

		await expect(manager.keepTakeaway([note.id], 2 * DAY_MS)).rejects.toThrow('quota full');
		expect(await db.sessions.get(KEPT_COLLECTION_SESSION_ID)).toBeUndefined();
		expect(await db.notes.get(note.id)).toMatchObject({ scope: 'session' });
		bulkPut.mockRestore();
	});

	it('clears into recovery, starts clean, and restores the old desk', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const oldId = manager.activeSession!.id;
		await createNote({ title: 'Recover me', sessionId: oldId, scope: 'session' });

		const fresh = await manager.clearActive(2 * DAY_MS);
		expect(fresh!.id).not.toBe(oldId);
		expect(manager.recoveringSessions.map((session) => session.id)).toContain(oldId);

		await manager.restore(oldId, 3 * DAY_MS);
		expect(manager.activeSession?.id).toBe(oldId);
		expect(manager.activeSession?.status).toBe('active');
		expect(await db.notes.where('sessionId').equals(oldId).count()).toBe(1);
	});

	it('isolates folder canvases with the same name between desks', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const firstId = manager.activeSession!.id;
		const first = await getOrCreateFolderCanvas('Ideas', firstId);
		const secondSession = await manager.createScratch(2 * DAY_MS);
		const second = await getOrCreateFolderCanvas('Ideas', secondSession.id);

		expect(first.id).not.toBe(second.id);
		expect(first.sessionId).toBe(firstId);
		expect(second.sessionId).toBe(secondSession.id);
	});

	it('stores operation receipts, marks reversions, and removes them with their desk', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const sessionId = manager.activeSession!.id;
		const operation = await createOperationRecord({
			sessionId,
			type: 'split-lines',
			inputNoteIds: ['source'],
			outputNoteIds: ['a', 'b'],
			payload: { mode: 'lines' }
		});

		await setOperationReverted(operation.id, true);
		expect((await db.operations.get(operation.id))?.revertedAt).toBeTypeOf('number');
		await setOperationReverted(operation.id, false);
		expect((await db.operations.get(operation.id))?.revertedAt).toBeUndefined();

		await deleteSessionPermanently(sessionId);
		expect(await db.operations.get(operation.id)).toBeUndefined();
	});

	it('purges only scratch desks past their recovery deadline', async () => {
		const manager = createSessionManager();
		await manager.bootstrap(DAY_MS);
		const recoveringId = manager.activeSession!.id;
		await manager.clearActive(2 * DAY_MS);
		await manager.keepActive(3 * DAY_MS);
		const keptId = manager.activeSession!.id;

		expect(await manager.purgePermanentlyExpired(8 * DAY_MS)).toBe(0);
		expect(await manager.purgePermanentlyExpired(10 * DAY_MS)).toBe(1);
		expect(await db.sessions.get(recoveringId)).toBeUndefined();
		expect(await db.sessions.get(keptId)).toMatchObject({ mode: 'kept' });
	});
});
