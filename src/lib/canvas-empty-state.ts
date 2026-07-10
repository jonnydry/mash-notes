import type { CanvasItem, Note } from './types';

const TEAM_WELCOME_ID = 'mash-team-welcome-v1';
const TEAM_WELCOME_SYSTEM = 'mash-team-welcome';
export const MASH_SPOON_LOGO = '/icons/New%20Icons/Mashed%20potato%20character@2x.png';

type WelcomeIdentityNote = Pick<Note, 'id' | 'title' | 'tags'> & {
	system?: string;
};

/** Exact identity check for the product-owned permanent welcome note. */
export function isPermanentMashWelcomeNote(note: WelcomeIdentityNote): boolean {
	if (note.id === TEAM_WELCOME_ID || note.system === TEAM_WELCOME_SYSTEM) return true;
	const tags = new Set(note.tags.map((tag) => tag.trim().toLowerCase()));
	return tags.has('welcome') && tags.has('mash-team');
}

/**
 * Recognize both the permanent team note and the legacy first-run welcome that
 * it migrates from. Keeping this UI-level check tolerant lets the heart remain
 * visible before, during, and after that migration.
 */
export function isMashWelcomeForPinnedEmptyState(note: WelcomeIdentityNote): boolean {
	if (isPermanentMashWelcomeNote(note)) return true;
	const tags = new Set(note.tags.map((tag) => tag.trim().toLowerCase()));
	return note.title.trim().toLowerCase() === 'welcome to mash' && tags.has('welcome');
}

/**
 * The Pinned board still reads as an empty favorites space when its only card
 * is Mash's permanent welcome. The card remains rendered; this only controls
 * the heart mascot and empty-state guidance behind it.
 */
export function shouldShowCanvasEmptyState(
	items: CanvasItem[],
	notesById: Map<string, Note>,
	isPinnedBoard: boolean
): boolean {
	if (items.length === 0) return true;
	if (!isPinnedBoard || items.length !== 1) return false;
	const note = notesById.get(items[0]!.noteId);
	return Boolean(note && isMashWelcomeForPinnedEmptyState(note));
}
