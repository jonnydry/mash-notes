import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
	buildSyncBundle,
	parseSyncBundle,
	mergeSyncBundle,
	applyDeskSnapshot,
	persistMergedSync,
	formatConflictSummary,
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

	it('round-trips a v3 sync bundle with desk', async () => {
		const notes = [note({ id: 'a', title: 'A', body: 'hi', modified: 10 })];
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

		const parsed = parseSyncBundle(JSON.stringify(bundle));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.bundle.notes[0].title).toBe('A');
		expect(parsed.bundle.desk?.canvases[0].folder).toBe('');
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
		await db.notes.put(
			note({ id: 'gone', title: 'Gone', modified: 5, deletedAt: Date.now() })
		);
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
			canvases: [
				{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }
			],
			items: [
				{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 100, y: 200, w: 220, h: 120 }
			],
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

	it('applies desk flow edges remapped to local item ids', async () => {
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 1
		});
		const desk = {
			canvases: [
				{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }
			],
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
		const notes = [note({ id: 'n1', title: 'One', modified: 5 })];
		const desk = {
			canvases: [
				{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }
			],
			items: [
				{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 40, y: 50 }
			],
			dismissed: { 'remote-root': ['gone'] }
		};
		const { desk: deskSummary } = await persistMergedSync(notes, desk, new Set(['n1']));
		expect(deskSummary?.itemsUpserted).toBe(1);
		expect(await db.notes.get('n1')).toMatchObject({ title: 'One' });
		const canvases = await db.canvases.toArray();
		expect(canvases).toHaveLength(1);
		expect([...getDismissedNoteIds(canvases[0].id)]).toEqual(['gone']);
	});

	it('persistMergedSync rolls notes back when desk apply fails', async () => {
		await db.notes.put(note({ id: 'keep', title: 'Keep me', modified: 1 }));
		const notes = [
			note({ id: 'keep', title: 'Keep me', modified: 1 }),
			note({ id: 'new', title: 'Should roll back', modified: 2 })
		];
		const desk = {
			canvases: [
				{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }
			],
			items: [
				{ id: 'ri1', canvasId: 'remote-root', noteId: 'new', x: 0, y: 0 }
			],
			dismissed: {}
		};

		const originalPut = db.canvasItems.put.bind(db.canvasItems);
		db.canvasItems.put = (async () => {
			throw new Error('forced desk failure');
		}) as unknown as typeof db.canvasItems.put;

		await expect(persistMergedSync(notes, desk, new Set(['keep', 'new']))).rejects.toThrow(
			'forced desk failure'
		);

		db.canvasItems.put = originalPut;

		expect(await db.notes.get('new')).toBeUndefined();
		expect(await db.notes.get('keep')).toMatchObject({ title: 'Keep me' });
		expect(await db.canvases.count()).toBe(0);
		expect(await db.canvasItems.count()).toBe(0);
	});

	it('rejects bad JSON and invalid notes', () => {
		expect(parseSyncBundle('nope').ok).toBe(false);
		expect(
			parseSyncBundle(JSON.stringify({ version: 3, notes: ['not-an-object'] })).ok
		).toBe(false);
		expect(parseSyncBundle(JSON.stringify({ version: 2, notes: [null] })).ok).toBe(false);
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
