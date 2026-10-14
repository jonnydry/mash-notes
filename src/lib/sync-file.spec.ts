import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import {
	addCanvasEdge,
	addCanvasElement,
	addNoteToCanvas,
	createNote,
	db,
	getOrCreateFolderCanvas,
	removeCanvasEdge,
	removeCanvasElement,
	removeCanvasItem,
	replaceCanvasEdges,
	updateCanvasItemPosition,
	replaceCanvasElements,
	replaceCanvasItemSubset
} from './db';
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

	it('round-trips the current bundle with appearance, canvas elements, and provenance', async () => {
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
			y: 20,
			color: 'amber'
		});
		await db.canvasElements.put({
			id: 'arrow-1',
			canvasId: 'c1',
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: 'i1', anchor: 'right' },
			end: { type: 'point', x: 320, y: 80 },
			zIndex: 1,
			created: 5,
			modified: 5,
			label: 'Next idea',
			color: 'blue'
		});
		dismissNoteFromCanvas('c1', 'gone');

		const bundle = await buildSyncBundle(notes);
		expect(bundle.version).toBe(SYNC_BUNDLE_VERSION);
		expect(bundle.desk?.items).toHaveLength(1);
		expect(bundle.desk?.items[0]?.color).toBe('amber');
		expect(bundle.desk?.elements).toEqual([
			expect.objectContaining({ id: 'arrow-1', label: 'Next idea', color: 'blue' })
		]);
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
		expect(parsed.bundle.desk?.elements?.[0]).toMatchObject({
			start: { type: 'item', itemId: 'i1', anchor: 'right' },
			end: { type: 'point', x: 320, y: 80 }
		});
	});

	it('rejects broken or unsupported canvas element data', () => {
		const base = {
			version: SYNC_BUNDLE_VERSION,
			exportedAt: 1,
			notes: [note({ id: 'a', title: 'A' })],
			desk: {
				canvases: [{ id: 'c1', folder: '', title: 'Desk', created: 1, modified: 1 }],
				items: [{ id: 'i1', canvasId: 'c1', noteId: 'a', x: 0, y: 0 }],
				elements: [
					{
						id: 'arrow-1',
						canvasId: 'c1',
						version: 1,
						kind: 'arrow',
						start: { type: 'item', itemId: 'missing', anchor: 'right' },
						end: { type: 'point', x: 100, y: 100 },
						zIndex: 0,
						created: 1,
						modified: 1
					}
				],
				dismissed: {}
			}
		};
		expect(parseSyncBundle(JSON.stringify(base))).toEqual({
			ok: false,
			error: 'Canvas element 1 contains a broken card binding'
		});
		base.desk.elements[0]!.start = { type: 'item', itemId: 'i1', anchor: 'right' };
		base.desk.elements[0]!.version = 2;
		expect(parseSyncBundle(JSON.stringify(base))).toEqual({
			ok: false,
			error: 'Canvas element 1 has an unsupported version'
		});
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
			dismissed: { 'remote-root': ['n2'] },
			deletions: []
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

	it('applies visual arrows with remapped bindings and card colors', async () => {
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
				{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 0, y: 0, color: 'rose' as const },
				{ id: 'ri2', canvasId: 'remote-root', noteId: 'n2', x: 300, y: 0 }
			],
			elements: [
				{
					id: 'remote-arrow',
					canvasId: 'remote-root',
					version: 1 as const,
					kind: 'arrow' as const,
					start: { type: 'item' as const, itemId: 'ri1', anchor: 'right' as const },
					end: { type: 'item' as const, itemId: 'ri2', anchor: 'left' as const },
					zIndex: 2,
					created: 5,
					modified: 5,
					label: 'Depends on'
				}
			],
			dismissed: {}
		};
		const summary = await applyDeskSnapshot(desk, new Set(['n1', 'n2']));
		expect(summary.elementsUpserted).toBe(1);
		const items = await db.canvasItems.where('canvasId').equals('local-root').toArray();
		const byNote = new Map(items.map((item) => [item.noteId, item]));
		expect(byNote.get('n1')?.color).toBe('rose');
		const elements = await db.canvasElements.where('canvasId').equals('local-root').toArray();
		expect(elements).toHaveLength(1);
		expect(elements[0]).toMatchObject({
			start: { type: 'item', itemId: byNote.get('n1')?.id },
			end: { type: 'item', itemId: byNote.get('n2')?.id },
			label: 'Depends on'
		});
	});

	it('persistMergedSync commits notes and desk together', async () => {
		const notes = [note({ id: 'n1', title: 'One', modified: 5, operationId: 'op-1' })];
		const desk = {
			canvases: [{ id: 'remote-root', folder: '', title: 'Desk', created: 1, modified: 10 }],
			items: [{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 40, y: 50 }],
			dismissed: { 'remote-root': ['gone'] },
			deletions: []
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable across desks: item ids are remapped, note ids and anchors are not. */
function arrowDeletionKey(fromNoteId: string, label: string): string {
	return JSON.stringify({
		kind: 'arrow',
		start: `item:${fromNoteId}:right`,
		end: 'point:320:80',
		label,
		color: 'blue',
		stroke: 'solid'
	});
}

function deskBundle(opts: {
	version?: number;
	exportedAt?: number;
	notes?: Note[];
	canvasId?: string;
	folder?: string;
	canvasModified: number;
	items?: unknown[];
	edges?: unknown[];
	elements?: unknown[];
	dismissed?: Record<string, string[]>;
	deletions?: unknown[];
}): string {
	const canvasId = opts.canvasId ?? 'remote-root';
	const desk: Record<string, unknown> = {
		canvases: [
			{
				id: canvasId,
				folder: opts.folder ?? '',
				title: 'Desk',
				created: 1,
				modified: opts.canvasModified
			}
		],
		items: opts.items ?? [],
		edges: opts.edges ?? [],
		elements: opts.elements ?? [],
		dismissed: opts.dismissed ?? {}
	};
	if (opts.deletions !== undefined) desk.deletions = opts.deletions;
	return JSON.stringify({
		version: opts.version ?? SYNC_BUNDLE_VERSION,
		exportedAt: opts.exportedAt ?? Date.now(),
		notes: opts.notes ?? [],
		desk
	});
}

async function importDesk(raw: string, noteIds: string[]) {
	const parsed = parseSyncBundle(raw);
	expect(parsed.ok).toBe(true);
	if (!parsed.ok || !parsed.bundle.desk) throw new Error('expected a desk bundle');
	await applyDeskSnapshot(parsed.bundle.desk, new Set(noteIds));
	return parsed.bundle;
}

describe('desk bundle delete markers', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		localStorage.clear();
	});

	it('keeps a removed card, link, and arrow removed after importing a newer bundle', async () => {
		const now = Date.now();
		const deletedAt = now - DAY_MS;
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: now - 5 * DAY_MS
		});
		await db.canvasItems.bulkPut([
			{ id: 'i1', canvasId: 'local-root', noteId: 'n1', x: 0, y: 0 },
			{ id: 'i2', canvasId: 'local-root', noteId: 'n2', x: 220, y: 0 },
			{ id: 'i3', canvasId: 'local-root', noteId: 'n3', x: 440, y: 0 }
		]);
		await db.canvasEdges.put({
			id: 'e1',
			canvasId: 'local-root',
			fromItemId: 'i2',
			toItemId: 'i3',
			created: now - 5 * DAY_MS
		});
		await db.canvasElements.put({
			id: 'arrow-1',
			canvasId: 'local-root',
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: 'i2', anchor: 'right' },
			end: { type: 'point', x: 320, y: 80 },
			zIndex: 1,
			created: now - 5 * DAY_MS,
			modified: now - 5 * DAY_MS,
			label: 'Depends',
			color: 'blue',
			stroke: 'solid'
		});

		const bundle = await importDesk(
			deskBundle({
				canvasModified: now - 2 * DAY_MS,
				items: [
					{ id: 'ri2', canvasId: 'remote-root', noteId: 'n2', x: 220, y: 0 },
					{ id: 'ri3', canvasId: 'remote-root', noteId: 'n3', x: 440, y: 0 }
				],
				deletions: [
					{ kind: 'item', canvasId: 'remote-root', noteId: 'n1', deletedAt },
					{
						kind: 'edge',
						canvasId: 'remote-root',
						fromNoteId: 'n2',
						toNoteId: 'n3',
						deletedAt
					},
					{
						kind: 'element',
						canvasId: 'remote-root',
						elementKey: arrowDeletionKey('n2', 'Depends'),
						deletedAt
					}
				]
			}),
			['n1', 'n2', 'n3']
		);
		expect(bundle.version).toBe(6);

		const items = await db.canvasItems.where('canvasId').equals('local-root').toArray();
		expect(items.map((item) => item.noteId).sort()).toEqual(['n2', 'n3']);
		expect(await db.canvasEdges.where('canvasId').equals('local-root').count()).toBe(0);
		expect(await db.canvasElements.where('canvasId').equals('local-root').count()).toBe(0);
	});

	it('does not restore a card from a bundle older than its delete marker', async () => {
		const now = Date.now();
		const deletedAt = now - 2 * DAY_MS;
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: now - 10 * DAY_MS
		});
		await db.canvasItems.put({
			id: 'i1',
			canvasId: 'local-root',
			noteId: 'n1',
			x: 10,
			y: 10
		});

		await importDesk(
			deskBundle({
				canvasModified: deletedAt,
				items: [],
				deletions: [{ kind: 'item', canvasId: 'remote-root', noteId: 'n1', deletedAt }]
			}),
			['n1']
		);
		expect(await db.canvasItems.count()).toBe(0);

		await importDesk(
			deskBundle({
				canvasModified: deletedAt - DAY_MS,
				items: [{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 80, y: 80 }]
			}),
			['n1']
		);
		expect(await db.canvasItems.count()).toBe(0);
	});

	it('an old-format bundle with no markers changes nothing', async () => {
		const now = Date.now();
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: now - 5 * DAY_MS
		});
		await db.canvasItems.bulkPut([
			{ id: 'i1', canvasId: 'local-root', noteId: 'n1', x: 15, y: 25 },
			{ id: 'i2', canvasId: 'local-root', noteId: 'n2', x: 200, y: 0 }
		]);
		await db.canvasEdges.put({
			id: 'e1',
			canvasId: 'local-root',
			fromItemId: 'i1',
			toItemId: 'i2',
			created: now - 5 * DAY_MS
		});
		await db.canvasElements.put({
			id: 'arrow-1',
			canvasId: 'local-root',
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: 'i1', anchor: 'right' },
			end: { type: 'item', itemId: 'i2', anchor: 'left' },
			zIndex: 1,
			created: now - 5 * DAY_MS,
			modified: now - 5 * DAY_MS,
			label: 'Depends',
			color: 'blue',
			stroke: 'solid'
		});
		dismissNoteFromCanvas('local-root', 'keep');

		await importDesk(
			deskBundle({
				version: 5,
				canvasModified: now,
				items: [],
				edges: [],
				elements: [],
				dismissed: { 'remote-root': ['other'] }
			}),
			['n1', 'n2']
		);

		const items = await db.canvasItems.where('canvasId').equals('local-root').toArray();
		expect(items.map((item) => item.noteId).sort()).toEqual(['n1', 'n2']);
		expect(items.find((item) => item.noteId === 'n1')).toMatchObject({ x: 15, y: 25 });
		expect(await db.canvasEdges.where('canvasId').equals('local-root').count()).toBe(1);
		expect(await db.canvasElements.where('canvasId').equals('local-root').count()).toBe(1);
		expect([...getDismissedNoteIds('local-root')]).toEqual(['keep']);
	});

	it('keeps the new desk marker when an old desk re-exports the card, unless it was edited after the delete', async () => {
		const now = Date.now();
		const deletedAt = now - 2 * DAY_MS;

		async function seed(folder: string, canvasId: string, noteId: string) {
			await db.canvases.put({
				id: canvasId,
				folder,
				title: 'Desk',
				created: 1,
				modified: now - 10 * DAY_MS
			});
			await db.canvasItems.put({
				id: `${noteId}-item`,
				canvasId,
				noteId,
				x: 4,
				y: 6
			});
		}

		// Order 1: new desk deletes, old desk later re-exports the card with no marker.
		await seed('order-a', 'canvas-a', 'card-a');
		await importDesk(
			deskBundle({
				folder: 'order-a',
				canvasId: 'remote-a',
				canvasModified: deletedAt,
				items: [],
				deletions: [{ kind: 'item', canvasId: 'remote-a', noteId: 'card-a', deletedAt }]
			}),
			['card-a']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-a').count()).toBe(0);

		await importDesk(
			deskBundle({
				folder: 'order-a',
				canvasId: 'remote-a',
				canvasModified: deletedAt - DAY_MS,
				items: [{ id: 'old-a', canvasId: 'remote-a', noteId: 'card-a', x: 4, y: 6 }]
			}),
			['card-a']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-a').count()).toBe(0);

		await importDesk(
			deskBundle({
				folder: 'order-a',
				canvasId: 'remote-a',
				canvasModified: deletedAt + DAY_MS,
				items: [{ id: 'edited-a', canvasId: 'remote-a', noteId: 'card-a', x: 90, y: 12 }]
			}),
			['card-a']
		);
		const edited = await db.canvasItems.where('canvasId').equals('canvas-a').toArray();
		expect(edited).toHaveLength(1);
		expect(edited[0]).toMatchObject({ noteId: 'card-a', x: 90, y: 12 });

		// Order 2: old desk exports first, new desk then deletes, old desk re-exports again.
		await seed('order-b', 'canvas-b', 'card-b');
		await importDesk(
			deskBundle({
				version: 5,
				folder: 'order-b',
				canvasId: 'remote-b',
				canvasModified: now - 8 * DAY_MS,
				items: [{ id: 'old-b', canvasId: 'remote-b', noteId: 'card-b', x: 4, y: 6 }]
			}),
			['card-b']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-b').count()).toBe(1);

		await importDesk(
			deskBundle({
				folder: 'order-b',
				canvasId: 'remote-b',
				canvasModified: deletedAt,
				items: [],
				deletions: [{ kind: 'item', canvasId: 'remote-b', noteId: 'card-b', deletedAt }]
			}),
			['card-b']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-b').count()).toBe(0);

		await importDesk(
			deskBundle({
				version: 5,
				folder: 'order-b',
				canvasId: 'remote-b',
				canvasModified: deletedAt - DAY_MS,
				items: [{ id: 'reexport-b', canvasId: 'remote-b', noteId: 'card-b', x: 4, y: 6 }]
			}),
			['card-b']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-b').count()).toBe(0);

		await importDesk(
			deskBundle({
				version: 5,
				folder: 'order-b',
				canvasId: 'remote-b',
				canvasModified: now,
				items: [{ id: 'edited-b', canvasId: 'remote-b', noteId: 'card-b', x: 30, y: 40 }]
			}),
			['card-b']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-b').toArray()).toEqual([
			expect.objectContaining({ noteId: 'card-b', x: 30, y: 40 })
		]);
	});

	it('keeps a removed card removed when an old v6 desk re-exports without deletions', async () => {
		const now = Date.now();
		const deletedAt = now - 2 * DAY_MS;
		await db.canvases.put({
			id: 'canvas-v6',
			folder: 'v6-reexport',
			title: 'Desk',
			created: 1,
			modified: now - 10 * DAY_MS
		});
		await db.canvasItems.put({
			id: 'card-v6-item',
			canvasId: 'canvas-v6',
			noteId: 'card-v6',
			x: 4,
			y: 6
		});
		await importDesk(
			deskBundle({
				folder: 'v6-reexport',
				canvasId: 'remote-v6',
				canvasModified: deletedAt,
				items: [],
				deletions: [{ kind: 'item', canvasId: 'remote-v6', noteId: 'card-v6', deletedAt }]
			}),
			['card-v6']
		);
		expect(await db.canvasItems.where('canvasId').equals('canvas-v6').count()).toBe(0);

		// An old v6 desk still has the card and does not emit deletion markers.
		const oldDeskExport = deskBundle({
			version: 6,
			folder: 'v6-reexport',
			canvasId: 'remote-v6',
			canvasModified: deletedAt - DAY_MS,
			items: [{ id: 'old-v6', canvasId: 'remote-v6', noteId: 'card-v6', x: 8, y: 9 }]
		});
		const oldDesk = JSON.parse(oldDeskExport) as { version: number; desk: Record<string, unknown> };
		expect(oldDesk.version).toBe(6);
		expect(oldDesk.desk).not.toHaveProperty('deletions');

		await importDesk(oldDeskExport, ['card-v6']);
		expect(await db.canvasItems.where('canvasId').equals('canvas-v6').count()).toBe(0);
	});

	it('replaces the removed-from-board set when a newer marked bundle wins', async () => {
		const now = Date.now();
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: now - 5 * DAY_MS
		});
		dismissNoteFromCanvas('local-root', 'keep-local');
		dismissNoteFromCanvas('local-root', 'shared');

		await importDesk(
			deskBundle({
				canvasModified: now,
				items: [],
				dismissed: { 'remote-root': ['shared', 'from-remote'] },
				deletions: []
			}),
			[]
		);
		expect([...getDismissedNoteIds('local-root')].sort()).toEqual(['from-remote', 'shared']);
	});

	it('drops delete markers after 90 days', async () => {
		const now = Date.now();
		const recent = now - 2 * DAY_MS;
		const expired = now - 91 * DAY_MS;
		await db.canvases.put({
			id: 'local-root',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: now - 100 * DAY_MS
		});
		await db.canvasItems.bulkPut([
			{ id: 'i1', canvasId: 'local-root', noteId: 'recent-card', x: 0, y: 0 },
			{ id: 'i2', canvasId: 'local-root', noteId: 'expired-card', x: 40, y: 0 }
		]);

		await importDesk(
			deskBundle({
				canvasModified: now,
				items: [],
				deletions: [
					{ kind: 'item', canvasId: 'remote-root', noteId: 'recent-card', deletedAt: recent },
					{ kind: 'item', canvasId: 'remote-root', noteId: 'expired-card', deletedAt: expired }
				]
			}),
			['recent-card', 'expired-card']
		);

		const notes = [
			note({ id: 'recent-card', title: 'Recent', modified: now }),
			note({ id: 'expired-card', title: 'Expired', modified: now })
		];
		const exported = await buildSyncBundle(notes);
		expect(exported.version).toBe(6);
		expect(exported.desk?.deletions).toEqual([
			expect.objectContaining({ kind: 'item', noteId: 'recent-card', deletedAt: recent })
		]);
		expect(await db.canvasItems.toArray()).toEqual([
			expect.objectContaining({ noteId: 'expired-card' })
		]);

		await importDesk(
			deskBundle({
				canvasModified: now - 50 * DAY_MS,
				items: [{ id: 'back', canvasId: 'remote-root', noteId: 'recent-card', x: 8, y: 9 }]
			}),
			['recent-card', 'expired-card']
		);
		expect((await db.canvasItems.toArray()).map((item) => item.noteId).sort()).toEqual([
			'expired-card'
		]);

		const marker = (await db.deskDeletions.toArray()).find((row) => row.noteId === 'recent-card');
		expect(marker?.deletedAt).toBe(recent);
		if (!marker) return;
		await db.deskDeletions.update(marker.id, { deletedAt: expired });
		const cleaned = await buildSyncBundle(notes);
		expect(cleaned.desk?.deletions ?? []).toEqual([]);
		await importDesk(
			deskBundle({
				canvasModified: now,
				items: [{ id: 'returned', canvasId: 'remote-root', noteId: 'recent-card', x: 3, y: 4 }]
			}),
			['recent-card']
		);
		expect(await db.canvasItems.where('noteId').equals('recent-card').count()).toBe(1);
	});

	it('does not bring a deleted card back when another card on the desk was moved later', async () => {
		const now = Date.now();
		const placedAt = now - 3 * DAY_MS;
		const deletedAt = now - 2 * DAY_MS;
		const movedAt = now - DAY_MS;
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(placedAt);
		try {
			const canvas = await getOrCreateFolderCanvas('');
			const n1 = await addNoteToCanvas(canvas.id, 'n1', { x: 0, y: 0 });
			const n2 = await addNoteToCanvas(canvas.id, 'n2', { x: 220, y: 0 });
			expect((await db.canvasItems.get(n1.id))?.modified).toBe(placedAt);

			nowSpy.mockReturnValue(movedAt);
			await updateCanvasItemPosition(n2.id, { x: 400, y: 12 });
			expect((await db.canvases.get(canvas.id))?.modified).toBe(movedAt);
			expect((await db.canvasItems.get(n1.id))?.modified).toBe(placedAt);

			nowSpy.mockReturnValue(now);
			await importDesk(
				deskBundle({
					canvasModified: now - 4 * DAY_MS,
					items: [
						{ id: 'ri1', canvasId: 'remote-root', noteId: 'n1', x: 1, y: 1 },
						{ id: 'ri2', canvasId: 'remote-root', noteId: 'n2', x: 2, y: 2 }
					],
					deletions: [{ kind: 'item', canvasId: 'remote-root', noteId: 'n1', deletedAt }]
				}),
				['n1', 'n2']
			);
		} finally {
			nowSpy.mockRestore();
		}

		expect((await db.canvasItems.toArray()).map((item) => item.noteId).sort()).toEqual(['n2']);
	});

	async function seedRemovedDesk() {
		const noteA = await createNote({ title: 'A', body: 'card' });
		const noteB = await createNote({ title: 'B', body: 'kept' });
		const canvas = await getOrCreateFolderCanvas('');
		const itemA = await addNoteToCanvas(canvas.id, noteA.id, { x: 4, y: 6 });
		const itemB = await addNoteToCanvas(canvas.id, noteB.id, { x: 240, y: 6 });
		const edge = await addCanvasEdge(canvas.id, itemA.id, itemB.id);
		const arrow = await addCanvasElement({
			id: 'arrow-undo',
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
		return { noteA, noteB, canvas, itemA, itemB, edge, arrow };
	}

	/** Same persistence undo uses: restore the card, then the link, then the arrow. */
	async function undoRemovedDesk(seed: Awaited<ReturnType<typeof seedRemovedDesk>>) {
		await replaceCanvasItemSubset(seed.canvas.id, [seed.itemA.id], [{ ...seed.itemA }]);
		await replaceCanvasEdges(seed.canvas.id, [{ ...seed.edge }]);
		await replaceCanvasElements(seed.canvas.id, [{ ...seed.arrow }]);
	}

	async function expectRestored(seed: Awaited<ReturnType<typeof seedRemovedDesk>>) {
		expect(await db.canvasItems.where('noteId').equals(seed.noteA.id).count()).toBe(1);
		expect(await db.canvasEdges.where('canvasId').equals(seed.canvas.id).count()).toBe(1);
		expect(await db.canvasElements.where('canvasId').equals(seed.canvas.id).count()).toBe(1);
	}

	it('keeps an undone card, link, and arrow after export and import', async () => {
		const seed = await seedRemovedDesk();
		await undoRemovedDesk(seed);
		const exported = await buildSyncBundle([seed.noteA, seed.noteB]);
		expect(exported.desk?.deletions ?? []).toEqual([]);
		await importDesk(JSON.stringify(exported), [seed.noteA.id, seed.noteB.id]);
		await expectRestored(seed);
	});

	it('keeps an undone card, link, and arrow when an older deletion bundle is imported', async () => {
		const seed = await seedRemovedDesk();
		const older = JSON.stringify(await buildSyncBundle([seed.noteA, seed.noteB]));
		expect(JSON.parse(older).desk.deletions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'item', noteId: seed.noteA.id }),
				expect.objectContaining({
					kind: 'edge',
					fromNoteId: seed.noteA.id,
					toNoteId: seed.noteB.id
				}),
				expect.objectContaining({ kind: 'element' })
			])
		);
		await undoRemovedDesk(seed);
		await importDesk(older, [seed.noteA.id, seed.noteB.id]);
		await expectRestored(seed);
	});

	it('keeps an undone card when the post-undo export is imported on a fresh desk', async () => {
		const seed = await seedRemovedDesk();
		const withMarker = JSON.stringify(await buildSyncBundle([seed.noteA, seed.noteB]));
		const markerDeletedAt = JSON.parse(withMarker).desk.deletions.find(
			(row: { kind?: string; noteId?: string; deletedAt?: number }) =>
				row.kind === 'item' && row.noteId === seed.noteA.id
		)?.deletedAt;
		expect(markerDeletedAt).toEqual(expect.any(Number));

		await undoRemovedDesk(seed);
		const undone = await buildSyncBundle([seed.noteA, seed.noteB]);
		const exportedCard = undone.desk?.items.find((item) => item.noteId === seed.noteA.id);
		expect(exportedCard?.modified).toBeGreaterThan(markerDeletedAt!);

		await db.delete();
		await db.open();
		localStorage.clear();
		await importDesk(JSON.stringify(undone), [seed.noteA.id, seed.noteB.id]);

		const fresh = await db.canvasItems.where('noteId').equals(seed.noteA.id).first();
		expect(fresh).toBeTruthy();
		expect(fresh?.modified).toBeGreaterThan(markerDeletedAt!);

		await importDesk(withMarker, [seed.noteA.id, seed.noteB.id]);
		const afterOlder = await db.canvasItems.where('noteId').equals(seed.noteA.id).first();
		expect(afterOlder).toBeTruthy();
		expect(afterOlder?.modified).toBeGreaterThan(markerDeletedAt!);
	});

	it('keeps an undone card when the post-undo bundle is imported into a wiped database', async () => {
		const seed = await seedRemovedDesk();
		await undoRemovedDesk(seed);
		const exported = JSON.stringify(await buildSyncBundle([seed.noteA, seed.noteB]));
		expect(JSON.parse(exported).desk.deletions).toEqual([]);

		await db.delete();
		await db.open();
		localStorage.clear();
		await importDesk(exported, [seed.noteA.id, seed.noteB.id]);

		expect(await db.canvasItems.where('noteId').equals(seed.noteA.id).count()).toBe(1);
		expect(await db.canvasEdges.count()).toBe(1);
		expect(await db.canvasElements.count()).toBe(1);
	});
});
