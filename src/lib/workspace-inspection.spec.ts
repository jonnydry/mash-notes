import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { inspectWorkspaceChangedAt } from './workspace-inspection';
import type { Note, NoteBlob } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id' | 'body'>): Note {
	return {
		title: partial.id,
		folder: '',
		tags: [],
		created: 1,
		modified: 10,
		pinned: 0,
		...partial
	};
}

function blob(id: string, created: number): NoteBlob {
	return {
		id,
		mime: 'image/png',
		bytes: new Uint8Array([1]).buffer,
		width: 1,
		height: 1,
		created
	};
}

describe('workspace health inspection', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('treats the permanent welcome note as an empty workspace', async () => {
		await db.notes.put(
			note({ id: 'welcome', body: 'Welcome', system: 'mash-team-welcome', modified: 20 })
		);

		await expect(inspectWorkspaceChangedAt()).resolves.toMatchObject({ hasContent: false });
	});

	it('tracks referenced visual assets without counting orphaned blobs', async () => {
		await db.notes.put(note({ id: 'image-note', body: '![Image](mash-blob:live-blob-01)' }));
		await db.noteBlobs.bulkPut([blob('live-blob-01', 50), blob('orphan-blob-01', 100)]);

		await expect(inspectWorkspaceChangedAt()).resolves.toEqual({
			changedAt: 50,
			hasContent: true
		});
	});
});
