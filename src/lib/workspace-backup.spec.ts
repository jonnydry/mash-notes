import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, KEPT_COLLECTION_SESSION_ID } from './db';
import type { Note, Session } from './types';
import {
	applyWorkspaceRestore,
	buildWorkspaceBackup,
	collectWorkspaceSnapshot,
	inspectAndPlanWorkspaceRestore,
	inspectWorkspaceBackup,
	serializeAndVerifyWorkspaceBackup,
	type WorkspaceSnapshot
} from './workspace-backup';

class MemoryStorage {
	private store = new Map<string, string>();
	get length() {
		return this.store.size;
	}
	key(index: number) {
		return [...this.store.keys()][index] ?? null;
	}
	getItem(key: string) {
		return this.store.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
	clear() {
		this.store.clear();
	}
}

Object.defineProperty(globalThis, 'localStorage', {
	value: new MemoryStorage(),
	configurable: true
});

const sessionA: Session = {
	id: 'session-a',
	title: 'Scratch ideas',
	mode: 'scratch',
	status: 'active',
	created: 10,
	modified: 20,
	lastMeaningfulActivityAt: 20,
	expiresAt: 9999
};

const sessionB: Session = {
	id: 'session-b',
	title: 'Kept work',
	mode: 'kept',
	status: 'active',
	created: 11,
	modified: 21,
	lastMeaningfulActivityAt: 21
};

function note(id: string, sessionId: string, title: string): Note {
	return {
		id,
		title,
		body: `${title} body`,
		folder: '',
		tags: [],
		created: 10,
		modified: 20,
		pinned: 0,
		sessionId,
		scope: sessionId === 'session-b' ? 'kept' : 'session'
	};
}

function fixtureSnapshot(): WorkspaceSnapshot {
	return {
		sessions: [sessionA, sessionB],
		notes: [note('note-a', 'session-a', 'Alpha'), note('note-b', 'session-b', 'Beta')],
		canvases: [
			{
				id: 'canvas-a',
				sessionId: 'session-a',
				folder: '',
				title: 'Root',
				created: 10,
				modified: 20
			}
		],
		canvasItems: [
			{ id: 'item-a', canvasId: 'canvas-a', noteId: 'note-a', x: 40, y: 60, w: 300, h: 220 }
		],
		canvasEdges: [],
		operations: [
			{
				id: 'operation-a',
				sessionId: 'session-a',
				type: 'mash',
				inputNoteIds: ['note-a'],
				outputNoteIds: ['note-a'],
				created: 20
			}
		],
		assets: [],
		dismissed: { 'canvas-a': ['note-b'] }
	};
}

describe('workspace backup', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		localStorage.clear();
	});

	it('serializes, verifies, and previews a complete workspace', async () => {
		const result = await serializeAndVerifyWorkspaceBackup('0.3.0-test', fixtureSnapshot());
		expect(result.backup.version).toBe(6);
		expect(result.record.counts).toEqual({ sessions: 2, notes: 2, assets: 0, operations: 1 });
		const inspected = await inspectAndPlanWorkspaceRestore(result.raw, {
			...fixtureSnapshot(),
			sessions: [],
			notes: [],
			canvases: [],
			canvasItems: [],
			operations: []
		});
		expect(inspected.ok).toBe(true);
		if (!inspected.ok) return;
		expect(inspected.plan?.added).toBeGreaterThanOrEqual(6);
		expect(inspected.plan?.conflicts).toBe(0);
	});

	it('materializes the virtual kept collection used by the welcome card', async () => {
		await db.sessions.put(sessionA);
		await db.notes.put({
			...note('welcome', KEPT_COLLECTION_SESSION_ID, 'Welcome'),
			system: 'mash-team-welcome'
		});
		const snapshot = await collectWorkspaceSnapshot();
		expect(snapshot.sessions.some((session) => session.id === KEPT_COLLECTION_SESSION_ID)).toBe(
			true
		);
		await expect(serializeAndVerifyWorkspaceBackup('0.3.0-test', snapshot)).resolves.toBeTruthy();
	});

	it('detects accidental corruption before restore', async () => {
		const { raw } = await serializeAndVerifyWorkspaceBackup('0.3.0-test', fixtureSnapshot());
		const corrupted = raw.replace('Alpha body', 'Changed body');
		expect(await inspectWorkspaceBackup(corrupted)).toEqual({
			ok: false,
			error: 'Workspace backup failed its integrity check'
		});
	});

	it('keeps the retained v6 workspace fixture readable', async () => {
		const raw = readFileSync(
			new URL('../../fixtures/formats/mash-bundles/v6/minimal.json', import.meta.url),
			'utf8'
		);
		const inspected = await inspectWorkspaceBackup(raw);
		expect(inspected.ok).toBe(true);
		if (!inspected.ok) return;
		expect(inspected.backup.sessions[0]?.title).toBe('Fixture desk');
	});

	it('allows the same folder path on different desks', async () => {
		const snapshot = fixtureSnapshot();
		snapshot.canvases.push({
			id: 'canvas-b',
			sessionId: 'session-b',
			folder: '',
			title: 'Root',
			created: 11,
			modified: 21
		});
		const result = await serializeAndVerifyWorkspaceBackup('0.3.0-test', snapshot);
		expect(result.backup.canvases).toHaveLength(2);
	});

	it('rejects duplicate folder paths inside one desk', async () => {
		const snapshot = fixtureSnapshot();
		snapshot.canvases.push({
			id: 'canvas-duplicate',
			sessionId: 'session-a',
			folder: '',
			title: 'Duplicate root',
			created: 11,
			modified: 21
		});
		await expect(serializeAndVerifyWorkspaceBackup('0.3.0-test', snapshot)).rejects.toThrow(
			'Duplicate canvas folder in session'
		);
	});

	it('rejects broken references even when generated locally', async () => {
		const broken = fixtureSnapshot();
		broken.canvasItems[0] = { ...broken.canvasItems[0]!, noteId: 'missing-note' };
		await expect(serializeAndVerifyWorkspaceBackup('0.3.0-test', broken)).rejects.toThrow(
			'broken canvas placement'
		);
	});

	it('rejects a missing referenced visual asset before download', async () => {
		const broken = fixtureSnapshot();
		broken.notes[0] = {
			...broken.notes[0]!,
			body: '![Missing](mash-blob:missing123)'
		};
		await expect(serializeAndVerifyWorkspaceBackup('0.3.0-test', broken)).rejects.toThrow(
			'missing visual asset'
		);
	});

	it('backs up multiple visual assets beyond the stricter desk-bundle aggregate limit', async () => {
		const snapshot = fixtureSnapshot();
		snapshot.assets = Array.from({ length: 5 }, (_, index) => ({
			id: `workspace-asset-${index}`,
			mime: 'image/png' as const,
			bytes: new Uint8Array(1_000_000).fill(index + 1).buffer,
			width: 100,
			height: 100,
			created: 20 + index
		}));
		snapshot.notes[0] = {
			...snapshot.notes[0]!,
			body: snapshot.assets
				.map((asset, index) => `![Workspace asset ${index}](mash-blob:${asset.id})`)
				.join('\n')
		};
		const result = await serializeAndVerifyWorkspaceBackup('0.3.0-test', snapshot);
		expect(result.record.counts.assets).toBe(5);
		expect(result.raw.length).toBeGreaterThan(6_500_000);
	});

	it('restores sessions, notes, canvas layout, and operations atomically', async () => {
		const backup = await buildWorkspaceBackup('0.3.0-test', fixtureSnapshot());
		const plan = await applyWorkspaceRestore(backup);
		expect(plan.added).toBeGreaterThan(0);
		const restored = await collectWorkspaceSnapshot();
		expect(restored.sessions.map((session) => session.id).sort()).toEqual([
			'session-a',
			'session-b'
		]);
		expect(restored.notes.map((entry) => entry.title).sort()).toEqual(['Alpha', 'Beta']);
		expect(restored.canvasItems[0]).toMatchObject({ noteId: 'note-a', x: 40, y: 60 });
		expect(restored.operations[0]?.id).toBe('operation-a');
	});

	it('rolls back durable writes when restore storage fails', async () => {
		const backup = await buildWorkspaceBackup('0.3.0-test', fixtureSnapshot());
		const failingWrite = vi
			.spyOn(db.canvasItems, 'bulkPut')
			.mockRejectedValueOnce(new DOMException('Storage full', 'QuotaExceededError'));
		await expect(applyWorkspaceRestore(backup)).rejects.toThrow('Storage full');
		failingWrite.mockRestore();
		expect(await db.sessions.count()).toBe(0);
		expect(await db.notes.count()).toBe(0);
		expect(await db.canvases.count()).toBe(0);
	});

	it('returns field conflicts for the review peel', async () => {
		await db.sessions.put(sessionA);
		await db.notes.put({ ...note('note-a', 'session-a', 'Local'), modified: 20 });
		const remote = fixtureSnapshot();
		remote.notes = [
			{
				...note('note-a', 'session-a', 'Remote'),
				body: 'Remote body',
				modified: 30
			}
		];
		remote.sessions = [{ ...sessionA, modified: 30 }];
		remote.canvasItems = [];
		remote.operations = [];
		const backup = await buildWorkspaceBackup('0.3.0-test', remote);
		const receipt = await applyWorkspaceRestore(backup);
		expect(receipt.conflictsForReview).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ noteId: 'note-a', field: 'body', chosen: 'remote' })
			])
		);
		expect((await db.notes.get('note-a'))?.body).toBe('Remote body');
	});
});
