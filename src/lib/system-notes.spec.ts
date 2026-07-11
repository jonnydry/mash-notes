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
		expect(note.body).toContain('Scoop');
		expect(note.body).toContain('Clip a region');
		expect(note.body).toContain('Scratch desks');
		expect(note.body).not.toContain('Spoon');
		expect(note.body).not.toContain('Jonathan');
		expect(note.body).not.toContain('Codex');
		expect(MASH_TEAM_WELCOME_IMAGE).toContain('Mashed%20potato%20character@2x.png');
		expect(isMashTeamWelcomeNote(note)).toBe(true);
	});

	it('rewrites an outdated team welcome body in place', async () => {
		const note = await ensureMashTeamWelcomeNote();
		await db.notes.put({
			...note,
			body: `Hey — welcome to Mash.

This is a desk for the half-formed stuff: scraps, PDFs, rambles, and the good ideas hiding inside them. Spoon (our little potato friend) is here for moral support.

## How the kitchen works

1. **Drop it in** — New note, paste a pile of text, or toss a PDF onto the board.
2. **Spread it out** — pull notes from the Library, then pan, zoom, and snap until the mess looks honest.
3. **Stir gently** — open stickies side by side, leave [[wikilinks]], or stitch cards into a Sequence when the order matters.
4. **Mash** — select a few notes and combine them into one draft. Unmash brings the ingredients back. Transform can split, stack, or sequence a set when you need finer cuts.
5. **Clip & plate** — in a PDF, grab text or Clip a region. When you are ready, Finish to export Markdown, PDF, a board image, or a full backup.

## House rules

- Scratch desks are for trying things; kept desks are for what you want to keep.
- It all lives in this browser — Settings has sync-bundle backup when you want a spare copy.
- Trash is recoverable. Pin the keepers. Folders and tags are seasoning, not the meal.

Have fun — and if it gets messy, that is kind of the point.`
		});
		const refreshed = await ensureMashTeamWelcomeNote();
		expect(refreshed.id).toBe(note.id);
		expect(refreshed.body).toBe(MASH_TEAM_WELCOME_BODY);
		expect(refreshed.body).toContain('Scoop');
		expect(refreshed.body).not.toContain('Spoon');
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
