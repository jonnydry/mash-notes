import type { CanvasItem, Note } from './types';
import {
	isMashTeamWelcomeCandidate,
	isMashTeamWelcomeNote,
	MASH_TEAM_WELCOME_IMAGE
} from './system-notes';

export const MASH_SPOON_LOGO = MASH_TEAM_WELCOME_IMAGE;

type WelcomeIdentityNote = Pick<Note, 'id' | 'title' | 'tags'> & {
	system?: string;
	body?: string;
};

/** Exact identity check for the product-owned permanent welcome note. */
export function isPermanentMashWelcomeNote(note: WelcomeIdentityNote): boolean {
	return isMashTeamWelcomeNote(note);
}

/**
 * Recognize both the permanent team note and the legacy first-run welcome that
 * it migrates from. Keeping this UI-level check tolerant lets the heart remain
 * visible before, during, and after that migration.
 */
export function isMashWelcomeForPinnedEmptyState(note: WelcomeIdentityNote): boolean {
	return isMashTeamWelcomeCandidate(note);
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
	const present = items.filter((item) => notesById.has(item.noteId));
	if (present.length === 0) return true;
	if (!isPinnedBoard || present.length !== 1) return false;
	const note = notesById.get(present[0]!.noteId);
	return Boolean(note && isMashWelcomeForPinnedEmptyState(note));
}
