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

/**
 * Offer the empty-desk CTA only on a blank non-pinned board before the user
 * has dismissed or completed the demo.
 */
export function shouldOfferTryAMash(opts: {
	dismissed: boolean;
	emptyStateVisible: boolean;
	isPinnedBoard: boolean;
}): boolean {
	if (opts.dismissed) return false;
	if (opts.isPinnedBoard) return false;
	return opts.emptyStateVisible;
}

export function tryAMashSuccessToast(): string {
	return 'Select both cards · Mash — Undo anytime';
}
