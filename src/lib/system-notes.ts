import { db, KEPT_COLLECTION_SESSION_ID } from './db';
import type { Note } from './types';

export const MASH_TEAM_WELCOME_ID = 'mash-team-welcome-v1';
export const MASH_TEAM_WELCOME_SYSTEM = 'mash-team-welcome' as const;
export const MASH_TEAM_WELCOME_IMAGE = '/icons/New%20Icons/Mashed%20potato%20character@2x.png';

const LEGACY_WELCOME_BODIES = [
	'Mash is where notes go to become useful.\n\nOpen Desk in the dock, then drag notes from the peel onto the desk. Select a few, then Mash, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode — missing links ask before creating.',
	'Mash is where notes go to become useful.\n\nDrag notes from the peel onto the desk. Select a few, then Mash, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode — missing links ask before creating.',
	`Welcome to Mash — a friendly place to turn rough thoughts into useful work.

## The basic loop

1. **Capture** — use New whenever an idea shows up.
2. **Arrange** — drag notes from the Library onto a board.
3. **Connect** — link related notes or stitch cards into a sequence.
4. **Mash** — combine a few notes into one editable draft. Your sources stay put.
5. **Share** — refine the result, then export Markdown, JSON, or a polished PDF.

## Good to know

- Mash saves locally in this browser.
- Trash is recoverable, and Settings has backup tools.
- Pin important notes and use folders or tags only when they help.

Made in-house with care by the Mash team — Jonathan + Codex. 🥔`,
	`Welcome to Mash — a friendly place to turn rough thoughts into useful work.

## The basic loop

1. **Capture** — press New, paste text, or drop a PDF onto the desk.
2. **Arrange** — drag notes from the Library onto a board. Pan, zoom, and snap as you like.
3. **Connect** — open stickies side by side, use [[wikilinks]], or stitch cards into a Sequence.
4. **Mash** — select a few notes and Mash them into one draft (Unmash restores the sources). Transform can split, stack, or sequence a set.
5. **Clip & finish** — from a PDF, select text or Clip a region. When you are done, Finish to export Markdown, PDF, a board image, or a full backup.

## Good to know

- Scratch desks are temporary; kept desks stick around.
- Everything lives in this browser — Settings has sync-bundle backup and import.
- Trash is recoverable. Pin what matters; folders and tags are optional.

Made in-house with care by the Mash team — Jonathan + Codex. 🥔`,
	`Hey — welcome to Mash.

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

Have fun — and if it gets messy, that is kind of the point.`,
	`Hey — you found Mash.

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
] as const;

export const MASH_TEAM_WELCOME_TITLE = 'A quick hello from Scoop';

export const MASH_TEAM_WELCOME_BODY = `Hey — Scoop here.

This desk is my favorite counter for half-baked thoughts: scraps, PDFs, rambles, and the surprisingly good bits stuck to them. I will cheer from the sidelines and never judge your pile.

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

Go make a beautiful mess. I believe in you.`;

export function isMashTeamWelcomeNote(note: Pick<Note, 'id'> & { system?: string }): boolean {
	return note.id === MASH_TEAM_WELCOME_ID || note.system === MASH_TEAM_WELCOME_SYSTEM;
}

/** Includes legacy/cross-device copies before their system marker is repaired. */
export function isMashTeamWelcomeCandidate(
	note: Pick<Note, 'id' | 'title' | 'body'> & { system?: string; tags?: string[] }
): boolean {
	if (isMashTeamWelcomeNote(note)) return true;
	if (
		(note.title === MASH_TEAM_WELCOME_TITLE ||
			note.title === 'A quick welcome from the Mash team') &&
		note.body === MASH_TEAM_WELCOME_BODY
	) {
		return true;
	}
	if (
		(note.title === 'Welcome to Mash' ||
			note.title === 'A quick welcome from the Mash team' ||
			note.title === MASH_TEAM_WELCOME_TITLE) &&
		LEGACY_WELCOME_BODIES.some((body) => body === note.body)
	) {
		return true;
	}
	const tags = new Set((note.tags ?? []).map((tag) => tag.trim().toLowerCase()));
	return note.title.trim().toLowerCase() === 'welcome to mash' && tags.has('welcome');
}

/** Create, migrate, or repair the permanent product-owned welcome note. */
export async function ensureMashTeamWelcomeNote(): Promise<Note> {
	const all = await db.notes.toArray();
	const existing =
		all.find((note) => note.system === MASH_TEAM_WELCOME_SYSTEM) ??
		all.find((note) => isMashTeamWelcomeCandidate(note));
	const now = Date.now();
	const desired: Note = {
		id: existing?.id ?? MASH_TEAM_WELCOME_ID,
		title: MASH_TEAM_WELCOME_TITLE,
		body: MASH_TEAM_WELCOME_BODY,
		folder: '',
		tags: ['welcome', 'mash-team'],
		links: [],
		created: existing?.created ?? now,
		modified: existing?.modified ?? now,
		pinned: 1,
		textAlign: 'left',
		system: MASH_TEAM_WELCOME_SYSTEM,
		scope: 'kept',
		sessionId: KEPT_COLLECTION_SESSION_ID,
		keptAt: existing?.keptAt ?? existing?.created ?? now
	};

	const needsRepair =
		!existing ||
		existing.deletedAt != null ||
		existing.title !== desired.title ||
		existing.body !== desired.body ||
		existing.folder !== desired.folder ||
		existing.pinned !== 1 ||
		existing.system !== MASH_TEAM_WELCOME_SYSTEM ||
		existing.scope !== 'kept' ||
		existing.sessionId !== KEPT_COLLECTION_SESSION_ID ||
		JSON.stringify(existing.tags) !== JSON.stringify(desired.tags);
	if (needsRepair) {
		desired.modified = now;
		await db.notes.put(desired);
		return desired;
	}
	return existing;
}
