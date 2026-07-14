import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
	buildSyncBundle,
	parseSyncBundle,
	mergeSyncBundle,
	applyDeskSnapshot,
	persistMergedSync,
	formatConflictSummary,
	SYNC_BUNDLE_MAX_CHARS,
	SYNC_BUNDLE_VERSION
} from './sync-file';
import { db } from './db';
import type { Note } from './types';
import { dismissNoteFromCanvas, getDismissedNoteIds } from './canvas-dismiss';

class MemoryStorage {
	private store = new Map<string, string>();
	clear() {
		this.store.clear();
	}
	get length() {
		return this.store.size;
	}
	key(index: number) {
		return [...this.store.keys()][index] ?? null;
	}
	getItem(key: string) {
		return this.store.has(key) ? this.store.get(key)! : null;
	}
	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	}
	removeItem(key: string) {
		this.store.delete(key);
	}
}

Object.defineProperty(globalThis, 'localStorage', {
	value: new MemoryStorage(),
	configurable: true
});

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
	return {
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

describe('sync-file', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		localStorage.clear();
	});

	it.each([1, 2, 3, 4, 5])('keeps the retained v%s desk-bundle fixture readable', (version) => {
		const raw = readFileSync(
			new URL(`../../fixtures/formats/mash-bundles/v${version}/minimal.json`, import.meta.url),
			'utf8'
		);
		const parsed = parseSyncBundle(raw);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.version).toBe(version);
	});

	it('round-trips a v4 sync bundle with desk and operation provenance', async () => {
		const notes = [note({ id: 'a', title: 'A', body: 'hi', modified: 10, operationId: 'op-1' })];
		await db.operations.put({
			id: 'op-1',
			sessionId: 'session-1',
			type: 'mash',
			inputNoteIds: ['source-a', 'source-b'],
			outputNoteIds: ['a'],
			created: 9
		});
		await db.canvases.put({
			id: 'c1',
			folder: '',
			title: 'Root',
			created: 1,
			modified: 5
		});
		await db.canvasItems.put({
			id: 'i1',
			canvasId: 'c1',
			noteId: 'a',
			x: 10,
			y: 20
		});
		dismissNoteFromCanvas('c1', 'gone');

		const bundle = await buildSyncBundle(notes);
		expect(bundle.version).toBe(SYNC_BUNDLE_VERSION);
		expect(bundle.desk?.items).toHaveLength(1);
		expect(bundle.desk?.dismissed.c1).toContain('gone');
		expect(bundle.tombstones).toEqual([]);
		expect(bundle.operations?.[0]).toMatchObject({ id: 'op-1', type: 'mash' });

		const parsed = parseSyncBundle(JSON.stringify(bundle));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.notes[0].title).toBe('A');
		expect(parsed.bundle.notes[0].operationId).toBe('op-1');
		expect(parsed.bundle.operations?.[0].outputNoteIds).toEqual(['a']);
		expect(parsed.bundle.desk?.canvases[0].folder).toBe('');
	});

	it('still accepts v3 tombstone bundles without operation history', () => {
		const parsed = parseSyncBundle(
			JSON.stringify({ version: 3, exportedAt: 1, notes: [], tombstones: [] })
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.operations).toBeUndefined();
	});

	it('still accepts v1 notes-only bundles', () => {
		const parsed = parseSyncBundle(
			JSON.stringify({
				version: 1,
				exportedAt: 1,
				notes: [note({ id: 'a', title: 'Legacy' })]
			})
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.desk).toBeUndefined();
	});

	it('still accepts v2 desk bundles', () => {
		const parsed = parseSyncBundle(
			JSON.stringify({
				version: 2,
				exportedAt: 1,
				notes: [note({ id: 'a', title: 'V2' })],
				desk: { canvases: [], items: [], dismissed: {} }
			})
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.desk).toBeTruthy();
		expect(parsed.bundle.tombstones).toBeUndefined();
	});

	it('applies tombstones so deletes propagate', () => {
		const local = [note({ id: 'a', title: 'Keep', body: 'x', modified: 5 })];
		const remote = {
			version: 3 as const,
			exportedAt: 10,
			notes: [] as Note[],
			tombstones: [{ id: 'a', deletedAt: 9 }]
		};
		const { notes, summary } = mergeSyncBundle(local, remote);
		expect(summary.removed).toBe(1);
		expect(notes.find((n) => n.id === 'a')?.deletedAt).toBe(9);
	});

	it('keeps a newer local note over an older tombstone', () => {
		const local = [note({ id: 'a', title: 'Edited', body: 'new', modified: 20 })];
		const remote = {
			version: 3 as const,
			exportedAt: 10,
			notes: [] as Note[],
			tombstones: [{ id: 'a', deletedAt: 9 }]
		};
		const { notes, summary } = mergeSyncBundle(local, remote);
		expect(summary.removed).toBe(0);
		expect(notes.find((n) => n.id === 'a')?.deletedAt).toBeUndefined();
		expect(notes.find((n) => n.id === 'a')?.body).toBe('new');
	});

	it('exports soft-deleted notes as tombstones', async () => {
		await db.notes.put(note({ id: 'gone', title: 'Gone', modified: 5, deletedAt: Date.now() }));
		const bundle = await buildSyncBundle([note({ id: 'a', title: 'A', modified: 10 })]);
		expect(bundle.notes.map((n) => n.id)).toEqual(['a']);
		expect(bundle.tombstones?.some((t) => t.id === 'gone')).toBe(true);
	});

	it('merges remote updates and reports conflicts', async () => {
		const local = [
			note({ id: 'a', title: 'Local', body: 'L', modified: 5 }),
			note({ id: 'b', title: 'Only local', modified: 3 })
		];
		const remote = await buildSyncBundle([
			note({ id: 'a', title: 'Remote', body: 'R', modified: 9 }),
			note({ id: 'c', title: 'New remote', modified: 8 })
		]);
		const { notes, summary } = mergeSyncBundle(local, remote);
		expect(summary.added).toBe(1);
		expect(summary.updated).toBe(1);
		expect(notes.find((n) => n.id === 'a')?.body).toBe('R');
		expect(notes.find((n) => n.id === 'c')?.title).toBe('New remote');
		expect(notes.find((n) => n.id === 'b')).toBeTruthy();
	});

	it('applies desk placements onto local canvases by folder', async () => {
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 1
		});
		const desk = {
			canvases: [{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }],
			items: [{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 100, y: 200, w: 220, h: 120 }],
			dismissed: { 'remote-root': ['n2'] }
		};
		const summary = await applyDeskSnapshot(desk, new Set(['n1', 'n2']));
		expect(summary.itemsUpserted).toBe(1);
		expect(summary.edgesUpserted).toBe(0);
		const items = await db.canvasItems.where('canvasId').equals('local-root').toArray();
		expect(items).toHaveLength(1);
		expect(items[0].x).toBe(100);
		expect([...getDismissedNoteIds('local-root')]).toEqual(['n2']);
	});

	it('does not resurrect remote-only placements when local canvas is newer', async () => {
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 100
		});
		const desk = {
			canvases: [{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }],
			items: [{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 100, y: 200, w: 220, h: 120 }],
			dismissed: {}
		};
		const summary = await applyDeskSnapshot(desk, new Set(['n1', 'n2']));
		expect(summary.itemsUpserted).toBe(0);
		expect(summary.itemsSkipped).toBe(1);
		const items = await db.canvasItems.where('canvasId').equals('local-root').toArray();
		expect(items).toHaveLength(0);
	});

	it('applies desk flow edges remapped to local item ids', async () => {
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 1
		});
		const desk = {
			canvases: [{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }],
			items: [
				{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 0, y: 0 },
				{ id: 'ri2', canvasId: 'remote-root', noteId: 'n2', x: 100, y: 0 }
			],
			edges: [
				{
					id: 're1',
					canvasId: 'remote-root',
					fromItemId: 'ri1',
					toItemId: 'ri2',
					created: 1
				}
			],
			dismissed: {}
		};
		const summary = await applyDeskSnapshot(desk, new Set(['n1', 'n2']));
		expect(summary.edgesUpserted).toBe(1);
		const edges = await db.canvasEdges.where('canvasId').equals('local-root').toArray();
		expect(edges).toHaveLength(1);
		const items = await db.canvasItems.where('canvasId').equals('local-root').toArray();
		const byNote = new Map(items.map((i) => [i.noteId, i.id]));
		expect(edges[0].fromItemId).toBe(byNote.get('n1'));
		expect(edges[0].toItemId).toBe(byNote.get('n2'));
	});

	it('persistMergedSync commits notes and desk together', async () => {
		const notes = [note({ id: 'n1', title: 'One', modified: 5, operationId: 'op-1' })];
		const desk = {
			canvases: [{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }],
			items: [{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 40, y: 50 }],
			dismissed: { 'remote-root': ['gone'] }
		};
		const operation = {
			id: 'op-1',
			sessionId: 'remote-session',
			type: 'split-lines',
			inputNoteIds: ['source'],
			outputNoteIds: ['n1'],
			created: 4
		};
		const { desk: deskSummary, operationsUpserted } = await persistMergedSync(
			notes,
			desk,
			new Set(['n1']),
			'local-session',
			[operation]
		);
		expect(deskSummary?.itemsUpserted).toBe(1);
		expect(operationsUpserted).toBe(1);
		expect(await db.notes.get('n1')).toMatchObject({ title: 'One' });
		expect(await db.operations.get('op-1')).toMatchObject({ sessionId: 'local-session' });
		const canvases = await db.canvases.toArray();
		expect(canvases).toHaveLength(1);
		expect([...getDismissedNoteIds(canvases[0].id)]).toEqual(['gone']);
	});

	it('remaps an operation id that belongs to another local desk', async () => {
		await db.operations.put({
			id: 'shared-op',
			sessionId: 'desk-a',
			type: 'mash',
			inputNoteIds: ['old-a', 'old-b'],
			outputNoteIds: ['old-result'],
			created: 1
		});
		const notes = [note({ id: 'new-result', title: 'Imported result', operationId: 'shared-op' })];
		await persistMergedSync(notes, undefined, new Set(['new-result']), 'desk-b', [
			{
				id: 'shared-op',
				sessionId: 'remote-desk',
				type: 'split-lines',
				inputNoteIds: ['source'],
				outputNoteIds: ['new-result'],
				created: 2
			}
		]);

		const imported = await db.notes.get('new-result');
		expect(imported?.operationId).not.toBe('shared-op');
		expect((await db.operations.get(imported!.operationId!))?.sessionId).toBe('desk-b');
		expect((await db.operations.get('shared-op'))?.sessionId).toBe('desk-a');
	});

	it('persistMergedSync rolls notes back when desk apply fails', async () => {
		await db.notes.put(note({ id: 'keep', title: 'Keep me', modified: 1 }));
		const notes = [
			note({ id: 'keep', title: 'Keep me', modified: 1 }),
			note({ id: 'new', title: 'Should roll back', modified: 2 })
		];
		const desk = {
			canvases: [{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }],
			items: [{ id: 'ri1', canvasId: 'remote-root', noteId: 'new', x: 0, y: 0 }],
			dismissed: {}
		};

		const originalBulkPut = db.canvasItems.bulkPut.bind(db.canvasItems);
		db.canvasItems.bulkPut = (async () => {
			throw new Error('forced desk failure');
		}) as unknown as typeof db.canvasItems.bulkPut;

		await expect(
			persistMergedSync(
				notes,
				desk,
				new Set(['keep', 'new']),
				undefined,
				[],
				[
					{
						id: 'rollback-blob-01',
						mime: 'image/png',
						width: 1,
						height: 1,
						dataBase64: 'AQID'
					}
				]
			)
		).rejects.toThrow('forced desk failure');

		db.canvasItems.bulkPut = originalBulkPut;

		expect(await db.notes.get('new')).toBeUndefined();
		expect(await db.notes.get('keep')).toMatchObject({ title: 'Keep me' });
		expect(await db.canvases.count()).toBe(0);
		expect(await db.canvasItems.count()).toBe(0);
		expect(await db.noteBlobs.get('rollback-blob-01')).toBeUndefined();
	});

	it('rejects bad JSON and invalid notes', () => {
		expect(parseSyncBundle('nope').ok).toBe(false);
		expect(parseSyncBundle(JSON.stringify({ version: 3, notes: ['not-an-object'] })).ok).toBe(
			false
		);
		expect(parseSyncBundle(JSON.stringify({ version: 2, notes: [null] })).ok).toBe(false);
	});

	it('rejects duplicate identifiers and ambiguous desk placements', () => {
		const duplicateNotes = parseSyncBundle(
			JSON.stringify({
				version: 5,
				notes: [note({ id: 'same', title: 'One' }), note({ id: 'same', title: 'Two' })]
			})
		);
		expect(duplicateNotes).toMatchObject({
			ok: false,
			error: expect.stringMatching(/duplicate note/i)
		});

		const duplicatePlacements = parseSyncBundle(
			JSON.stringify({
				version: 5,
				notes: [note({ id: 'n1', title: 'One' })],
				desk: {
					canvases: [{ id: 'c1', folder: '', title: 'Desk' }],
					items: [
						{ id: 'i1', canvasId: 'c1', noteId: 'n1' },
						{ id: 'i2', canvasId: 'c1', noteId: 'n1' }
					]
				}
			})
		);
		expect(duplicatePlacements).toMatchObject({
			ok: false,
			error: expect.stringMatching(/duplicate note placement/i)
		});
	});

	it('rejects oversized and resource-amplifying bundle fields', () => {
		expect(parseSyncBundle(' '.repeat(SYNC_BUNDLE_MAX_CHARS + 1))).toEqual({
			ok: false,
			error: 'Sync file too large'
		});
		expect(
			parseSyncBundle(
				JSON.stringify({
					version: 5,
					notes: [],
					blobs: [
						{
							id: 'valid-blob-01',
							mime: 'image/png',
							width: 1,
							height: 1,
							dataBase64: '***not-base64***'
						}
					]
				})
			).ok
		).toBe(false);
		expect(
			parseSyncBundle(
				JSON.stringify({
					version: 4,
					notes: [],
					operations: [
						{
							id: 'op',
							type: 'test',
							inputNoteIds: Array.from({ length: 1001 }, (_, i) => `n-${i}`),
							outputNoteIds: []
						}
					]
				})
			).ok
		).toBe(false);
	});

	it('formats conflict summaries', () => {
		const text = formatConflictSummary([
			{
				noteId: 'abcdefghij',
				field: 'body',
				local: 'a',
				remote: 'b',
				chosen: 'remote'
			}
		]);
		expect(text).toContain('body');
		expect(text).toContain('remote');
	});
});
