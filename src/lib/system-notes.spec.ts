import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db, deleteNote, KEPT_COLLECTION_SESSION_ID, syncNoteUpdateAsync, updateNote } from './db';
import {
	ensureMashTeamWelcomeNote,
	isMashTeamWelcomeNote,
	MASH_TEAM_WELCOME_BODY,
	MASH_TEAM_WELCOME_IMAGE,
	MASH_TEAM_WELCOME_TITLE
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
		expect(note.title).toBe(MASH_TEAM_WELCOME_TITLE);
		expect(note.body).toBe(MASH_TEAM_WELCOME_BODY);
		expect(note.body).toContain("I'm Scoop");
		expect(note.body).toContain("I'll be right here");
		expect(note.body).toContain('Mash');
		expect(note.body).toContain('Finish');
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
			title: 'A quick welcome from the Mash team',
			body: `Hey — you found Mash.

Think of this as a kitchen counter for half-baked thoughts: scraps, PDFs, rambles, and the surprisingly good bits stuck to them. Scoop, our cheerful potato pal, will cheer from the sidelines (and never judge your pile).

## How the kitchen works

1. **Toss it in** — hit New, paste a chaotic blob, or drop a PDF on the board like it belongs there.
2. **Spread the mess** — drag notes out of the Library, then pan, zoom, and snap until it looks deliciously intentional.
3. **Stir it around** — open stickies side by side, leave [[wikilinks]] like breadcrumbs, or stitch cards into a Sequence when the story needs an order.
4. **Mash time** — pick a few notes and mash them into one draft. Unmash brings the ingredients back if you get ambitious. Transform can split, stack, or sequence when you want finer cuts.
5. **Clip & plate** — in a PDF, snag text or Clip a region. When dinner is ready, Finish with Markdown, PDF, a board image, or a full backup for later.

## House rules

- Scratch desks are for experiments. Kept desks are for the keepers.
- Everything lives in this browser — Settings has a sync-bundle backup when you want a spare serving.
- Trash is recoverable. Pin the good stuff. Folders and tags are optional seasoning.

Go make a beautiful mess. Scoop believes in you.`
		});
		const refreshed = await ensureMashTeamWelcomeNote();
		expect(refreshed.id).toBe(note.id);
		expect(refreshed.title).toBe(MASH_TEAM_WELCOME_TITLE);
		expect(refreshed.body).toBe(MASH_TEAM_WELCOME_BODY);
		expect(refreshed.body).toContain("I'm Scoop");
		expect(refreshed.body).not.toContain('Spoon');
	});

	it('cannot be edited or moved to Trash through note CRUD', async () => {
		const note = await ensureMashTeamWelcomeNote();
		await updateNote(note.id, { title: 'Changed', pinned: 0 });
		await syncNoteUpdateAsync(note.id, { body: 'Changed' });
		await deleteNote(note.id);
		const stored = await db.notes.get(note.id);
		expect(stored?.title).toBe(MASH_TEAM_WELCOME_TITLE);
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
