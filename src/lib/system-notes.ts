import { db, KEPT_COLLECTION_SESSION_ID } from './db';
import type { Note } from './types';

export const MASH_TEAM_WELCOME_ID = 'mash-team-welcome-v1';
export const MASH_TEAM_WELCOME_SYSTEM = 'mash-team-welcome' as const;
export const MASH_TEAM_WELCOME_IMAGE = '/icons/New%20Icons/Mashed%20potato%20character@2x.png';

const LEGACY_WELCOME_BODIES = [
	'Mash is where notes go to become useful.\n\nOpen Desk in the dock, then drag notes from the peel onto the desk. Select a few, then Mash, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode — missing links ask before creating.',
	'Mash is where notes go to become useful.\n\nDrag notes from the peel onto the desk. Select a few, then Mash, Copy, or Export.\n\nTry a [[Project ideas]] link in preview mode — missing links ask before creating.'
] as const;

export const MASH_TEAM_WELCOME_BODY = `Welcome to Mash — a friendly place to turn rough thoughts into useful work.

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

Made in-house with care by the Mash team — Jonathan + Codex. 🥔`;

export function isMashTeamWelcomeNote(note: Pick<Note, 'id'> & { system?: string }): boolean {
	return note.id === MASH_TEAM_WELCOME_ID || note.system === MASH_TEAM_WELCOME_SYSTEM;
}

/** Includes legacy/cross-device copies before their system marker is repaired. */
export function isMashTeamWelcomeCandidate(
	note: Pick<Note, 'id' | 'title' | 'body'> & { system?: string; tags?: string[] }
): boolean {
	if (isMashTeamWelcomeNote(note)) return true;
	if (note.title === 'A quick welcome from the Mash team' && note.body === MASH_TEAM_WELCOME_BODY) {
		return true;
	}
	if (note.title === 'Welcome to Mash' && LEGACY_WELCOME_BODIES.some((body) => body === note.body)) {
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
		title: 'A quick welcome from the Mash team',
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
