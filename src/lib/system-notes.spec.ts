import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db, deleteNote, KEPT_COLLECTION_SESSION_ID, syncNoteUpdateAsync, updateNote } from './db';
import {
	ensureMashTeamWelcomeNote,
	isMashTeamWelcomeNote,
	MASH_TEAM_WELCOME_BODY,
	MASH_TEAM_WELCOME_IMAGE
} from './system-notes';

describe('Mash team welcome note', () => {
	beforeEach(async () => {
		await db.canvasEdges.clear();
		await db.canvasItems.clear();
		await db.canvases.clear();
		await db.notes.clear();
		await db.sessions.clear();
		await db.operations.clear();
	});

	it('is created pinned with the in-house guide and kept scope', async () => {
		const note = await ensureMashTeamWelcomeNote();
		expect(note.pinned).toBe(1);
		expect(note.system).toBe('mash-team-welcome');
		expect(note.scope).toBe('kept');
		expect(note.sessionId).toBe(KEPT_COLLECTION_SESSION_ID);
		expect(note.body).toBe(MASH_TEAM_WELCOME_BODY);
		expect(note.body).toContain('Jonathan + Codex');
		expect(MASH_TEAM_WELCOME_IMAGE).toContain('Mashed%20potato%20character@2x.png');
		expect(isMashTeamWelcomeNote(note)).toBe(true);
	});

	it('cannot be edited or moved to Trash through note CRUD', async () => {
		const note = await ensureMashTeamWelcomeNote();
		await updateNote(note.id, { title: 'Changed', pinned: 0 });
		await syncNoteUpdateAsync(note.id, { body: 'Changed' });
		await deleteNote(note.id);
		const stored = await db.notes.get(note.id);
		expect(stored?.title).toBe('A quick welcome from the Mash team');
		expect(stored?.body).toBe(MASH_TEAM_WELCOME_BODY);
		expect(stored?.pinned).toBe(1);
		expect(stored?.deletedAt).toBeUndefined();
	});

	it('upgrades the original seed in place instead of creating a duplicate', async () => {
		const legacyId = 'legacy-welcome';
		await db.notes.put({
			id: legacyId,
			title: 'Welcome to Mash',
			body: 'Mash is where notes go to become useful.\n\nDrag notes from the peel onto the desk. Select a few, then Mash, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode — missing links ask before creating.',
			folder: '',
			tags: ['welcome'],
			created: 1,
			modified: 1,
			pinned: 0
		});
		const upgraded = await ensureMashTeamWelcomeNote();
		expect(upgraded.id).toBe(legacyId);
		expect(upgraded.system).toBe('mash-team-welcome');
		expect(upgraded.pinned).toBe(1);
		expect(await db.notes.count()).toBe(1);
	});

	it('restores a soft-deleted team welcome', async () => {
		const note = await ensureMashTeamWelcomeNote();
		await db.notes.put({ ...note, deletedAt: Date.now(), pinned: 0 });
		const restored = await ensureMashTeamWelcomeNote();
		expect(restored.id).toBe(note.id);
		expect(restored.deletedAt).toBeUndefined();
		expect(restored.pinned).toBe(1);
	});
});
