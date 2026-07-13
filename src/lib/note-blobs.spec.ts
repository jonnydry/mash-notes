import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, deleteNote, deleteSessionPermanently, createNote } from './db';
import {
	blobIdFromRef,
	clearBlobUrlCache,
	composeMashBlobSrc,
	dataUrlToBytes,
	deleteBlobIdsIfUnreferenced,
	extractBlobIdsFromActiveNotes,
	extractBlobIdsFromBody,
	gcBlobsAfterNoteDelete,
	gcOrphanNoteBlobs,
	imageNoteBodyFromBlob,
	isMashBlobRef,
	migrateLeadingDataUrlBody,
	putNoteBlob,
	putNoteBlobFromDataUrl,
	releaseDisplayUrl,
	resolveDisplayUrl
} from './note-blobs';
import type { Note } from './types';

const TINY_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function baseNote(partial: Partial<Note> & { id: string; body: string }): Note {
	return {
		title: partial.title ?? partial.id,
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

describe('note-blobs', () => {
	beforeEach(async () => {
		clearBlobUrlCache();
		await db.delete();
		await db.open();
	});

	it('parses mash-blob refs strictly', () => {
		expect(isMashBlobRef('mash-blob:abc-12345')).toBe(true);
		expect(isMashBlobRef('mash-blob:../../evil')).toBe(false);
		expect(isMashBlobRef('data:image/png;base64,aa')).toBe(false);
		expect(blobIdFromRef('mash-blob:abc-12345')).toBe('abc-12345');
		expect(composeMashBlobSrc('xyz')).toBe('mash-blob:xyz');
	});

	it('round-trips a data URL into a blob row', async () => {
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		expect(row.mime).toBe('image/png');
		expect(row.bytes.byteLength).toBeGreaterThan(0);
		const loaded = await db.noteBlobs.get(row.id);
		expect(loaded?.id).toBe(row.id);
		const body = imageNoteBodyFromBlob(row.id, 'Dot', 'caption');
		expect(body).toContain(`mash-blob:${row.id}`);
		expect(body).not.toContain('base64');
		expect(extractBlobIdsFromBody(body)).toEqual([row.id]);
	});

	it('decodes data URLs', () => {
		const parsed = dataUrlToBytes(TINY_PNG);
		expect(parsed?.mime).toBe('image/png');
		expect(parsed?.bytes.byteLength).toBeGreaterThan(10);
	});

	it('migrates a leading data-URL body to mash-blob', async () => {
		const body = `![Chart](${TINY_PNG})\n\n_From desk_`;
		const next = await migrateLeadingDataUrlBody(body);
		expect(next).toBeTruthy();
		expect(next).toContain('mash-blob:');
		expect(next).not.toContain('base64');
		expect(next).toContain('_From desk_');
		const ids = extractBlobIdsFromBody(next!);
		expect(ids).toHaveLength(1);
		const row = await db.noteBlobs.get(ids[0]!);
		expect(row).toBeTruthy();
	});

	it('puts an explicit blob id', async () => {
		const parsed = dataUrlToBytes(TINY_PNG)!;
		const row = await putNoteBlob({
			id: 'custom-blob-id-01',
			mime: parsed.mime,
			bytes: parsed.bytes,
			width: 1,
			height: 1
		});
		expect(row.id).toBe('custom-blob-id-01');
	});

	it('ignores soft-deleted notes when collecting active blob refs', () => {
		const blobId = 'shared-blob-01';
		const active = baseNote({
			id: 'a',
			body: imageNoteBodyFromBlob(blobId, 'A')
		});
		const gone = baseNote({
			id: 'b',
			body: imageNoteBodyFromBlob(blobId, 'B'),
			deletedAt: 99
		});
		const onlyDeleted = baseNote({
			id: 'c',
			body: imageNoteBodyFromBlob('only-deleted-blob', 'C'),
			deletedAt: 100
		});
		const refs = extractBlobIdsFromActiveNotes([active, gone, onlyDeleted]);
		expect([...refs]).toEqual([blobId]);
	});

	it('frees blobs on soft-delete when no active note still references them', async () => {
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		const body = imageNoteBodyFromBlob(row.id, 'Solo');
		await db.notes.put(
			baseNote({
				id: 'solo',
				body,
				sessionId: 's1',
				scope: 'session'
			})
		);
		// Soft-delete keeps the row (tombstone) but must not pin pixels.
		await db.notes.put(
			baseNote({
				id: 'solo',
				body,
				sessionId: 's1',
				scope: 'session',
				deletedAt: Date.now()
			})
		);
		await gcBlobsAfterNoteDelete(body);
		expect(await db.noteBlobs.get(row.id)).toBeUndefined();
	});

	it('keeps a blob when another active note still references it', async () => {
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		const body = imageNoteBodyFromBlob(row.id, 'Shared');
		await db.notes.bulkPut([
			baseNote({ id: 'keep', body, deletedAt: undefined }),
			baseNote({ id: 'drop', body, deletedAt: Date.now() })
		]);
		await gcBlobsAfterNoteDelete(body);
		expect(await db.noteBlobs.get(row.id)).toBeTruthy();
	});

	it('gcOrphanNoteBlobs reclaims unreferenced rows', async () => {
		const live = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		const orphan = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		await db.notes.put(baseNote({ id: 'n1', body: imageNoteBodyFromBlob(live.id, 'Live') }));
		const n = await gcOrphanNoteBlobs();
		expect(n).toBe(1);
		expect(await db.noteBlobs.get(live.id)).toBeTruthy();
		expect(await db.noteBlobs.get(orphan.id)).toBeUndefined();
	});

	it('deleteBlobIdsIfUnreferenced can ignore a stale note id (rotate path)', async () => {
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		// IDB still has the pre-rotate body for this note.
		await db.notes.put(baseNote({ id: 'rotating', body: imageNoteBodyFromBlob(row.id, 'Old') }));
		const deleted = await deleteBlobIdsIfUnreferenced([row.id], {
			ignoreNoteIds: ['rotating']
		});
		expect(deleted).toBe(1);
		expect(await db.noteBlobs.get(row.id)).toBeUndefined();
	});

	it('deleteNote soft-delete GCs exclusive image blobs', async () => {
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		const note = await createNote({
			title: 'Pic',
			body: imageNoteBodyFromBlob(row.id, 'Pic'),
			folder: '',
			tags: [],
			links: [],
			sessionId: 's1',
			scope: 'session'
		});
		// createNote may re-assign body; re-put blob ref if needed
		await db.notes.update(note.id, { body: imageNoteBodyFromBlob(row.id, 'Pic') });
		await deleteNote(note.id);
		expect(await db.noteBlobs.get(row.id)).toBeUndefined();
	});

	it('deleteSessionPermanently GCs blobs for purged notes', async () => {
		const { createSessionRecord } = await import('./db');
		const session = await createSessionRecord({ title: 'Desk', mode: 'scratch' });
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		await db.notes.put(
			baseNote({
				id: 'purged-img',
				body: imageNoteBodyFromBlob(row.id, 'Gone'),
				sessionId: session.id,
				scope: 'session'
			})
		);
		await deleteSessionPermanently(session.id);
		expect(await db.notes.get('purged-img')).toBeUndefined();
		expect(await db.noteBlobs.get(row.id)).toBeUndefined();
	});

	it('dedupes concurrent resolveDisplayUrl into one object URL', async () => {
		const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-1');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const row = await putNoteBlobFromDataUrl(TINY_PNG, { width: 1, height: 1 });
		const src = composeMashBlobSrc(row.id);
		const [a, b] = await Promise.all([resolveDisplayUrl(src), resolveDisplayUrl(src)]);
		expect(a).toBe('blob:mock-1');
		expect(b).toBe('blob:mock-1');
		expect(createSpy).toHaveBeenCalledTimes(1);
		releaseDisplayUrl(src);
		releaseDisplayUrl(src);
		expect(revokeSpy).toHaveBeenCalledTimes(1);
		createSpy.mockRestore();
		revokeSpy.mockRestore();
	});
});
