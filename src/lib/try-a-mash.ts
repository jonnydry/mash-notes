/**
 * First-session “Try a mash” — one disposable cook, then get out of the way.
 * Stored locally; never uploads or requires accounts.
 */

export const TRY_A_MASH_DISMISSED_KEY = 'mash.tryAMashDismissed';
export const TRY_A_MASH_TAG = 'try-a-mash';

export type TryAMashDraft = {
	title: string;
	body: string;
	tags: string[];
};

/** Two short kitchen scraps ready to select and Mash. */
export function tryAMashDrafts(): TryAMashDraft[] {
	return [
		{
			title: 'Half-baked idea',
			body: 'What if the desk wiped itself when you’re done?',
			tags: [TRY_A_MASH_TAG]
		},
		{
			title: 'Another scrap',
			body: 'Keep only the good bits. Clear the rest.',
			tags: [TRY_A_MASH_TAG]
		}
	];
}

export function isTryAMashDismissed(
	storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined'
		? localStorage
		: null
): boolean {
	if (!storage) return false;
	try {
		return storage.getItem(TRY_A_MASH_DISMISSED_KEY) === '1';
	} catch {
		return false;
	}
}

export function dismissTryAMash(
	storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined'
		? localStorage
		: null
): void {
	if (!storage) return;
	try {
		storage.setItem(TRY_A_MASH_DISMISSED_KEY, '1');
	} catch {
		/* private mode / quota */
	}
}

/** True when a note was spawned by the empty-desk demo. */
export function isTryAMashDemoNote(note: { tags?: string[] | null }): boolean {
	return (note.tags ?? []).includes(TRY_A_MASH_TAG);
}

/**
 * Offer the empty-desk CTA only on the root Desk (not folder/tag/pinned boards)
 * before the user has dismissed or completed the demo.
 */
export function shouldOfferTryAMash(opts: {
	dismissed: boolean;
	emptyStateVisible: boolean;
	isPinnedBoard: boolean;
	/** Root Desk only — folder/tag/linked boards stay quiet. */
	isRootDesk?: boolean;
}): boolean {
	if (opts.dismissed) return false;
	if (opts.isPinnedBoard) return false;
	if (opts.isRootDesk === false) return false;
	return opts.emptyStateVisible;
}

export function tryAMashSuccessToast(): string {
	return 'Both selected · Mash — Undo anytime';
}

/** After the demo pair is mashed — point at Unmash without leaving the desk. */
export function tryAMashAfterMashToast(): string {
	return 'Mashed · Unmash restores scraps · Undo anytime';
}

/**
 * Demo mashes stay on the canvas so the first cook doesn’t jump into the editor stage.
 * Returns true when every source is a try-a-mash demo scrap.
 */
export function shouldStayOnDeskAfterMash(sourceNotes: Array<{ tags?: string[] | null }>): boolean {
	return sourceNotes.length >= 2 && sourceNotes.every(isTryAMashDemoNote);
}
