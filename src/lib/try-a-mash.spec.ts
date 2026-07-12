import { describe, expect, it } from 'vitest';
import {
	TRY_A_MASH_DISMISSED_KEY,
	TRY_A_MASH_TAG,
	dismissTryAMash,
	isTryAMashDemoNote,
	isTryAMashDismissed,
	shouldOfferTryAMash,
	shouldStayOnDeskAfterMash,
	tryAMashAfterMashToast,
	tryAMashDrafts,
	tryAMashSuccessToast
} from './try-a-mash';

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(initial));
	return {
		get length() {
			return map.size;
		},
		clear() {
			map.clear();
		},
		getItem(key: string) {
			return map.has(key) ? map.get(key)! : null;
		},
		key(index: number) {
			return [...map.keys()][index] ?? null;
		},
		removeItem(key: string) {
			map.delete(key);
		},
		setItem(key: string, value: string) {
			map.set(key, value);
		}
	};
}

describe('try-a-mash', () => {
	it('provides two tagged demo scraps', () => {
		const drafts = tryAMashDrafts();
		expect(drafts).toHaveLength(2);
		expect(drafts.every((d) => d.tags.includes(TRY_A_MASH_TAG))).toBe(true);
		expect(drafts[0]!.title).toBeTruthy();
		expect(drafts[1]!.body).toBeTruthy();
	});

	it('persists dismiss forever', () => {
		const storage = memoryStorage();
		expect(isTryAMashDismissed(storage)).toBe(false);
		dismissTryAMash(storage);
		expect(storage.getItem(TRY_A_MASH_DISMISSED_KEY)).toBe('1');
		expect(isTryAMashDismissed(storage)).toBe(true);
	});

	it('only offers on empty root Desk when not dismissed', () => {
		expect(
			shouldOfferTryAMash({
				dismissed: false,
				emptyStateVisible: true,
				isPinnedBoard: false,
				isRootDesk: true
			})
		).toBe(true);
		expect(
			shouldOfferTryAMash({ dismissed: true, emptyStateVisible: true, isPinnedBoard: false })
		).toBe(false);
		expect(
			shouldOfferTryAMash({ dismissed: false, emptyStateVisible: false, isPinnedBoard: false })
		).toBe(false);
		expect(
			shouldOfferTryAMash({ dismissed: false, emptyStateVisible: true, isPinnedBoard: true })
		).toBe(false);
		expect(
			shouldOfferTryAMash({
				dismissed: false,
				emptyStateVisible: true,
				isPinnedBoard: false,
				isRootDesk: false
			})
		).toBe(false);
		// Legacy callers without isRootDesk still offer on empty non-pinned boards
		expect(
			shouldOfferTryAMash({ dismissed: false, emptyStateVisible: true, isPinnedBoard: false })
		).toBe(true);
	});

	it('detects demo scraps and keeps their mash on the desk', () => {
		const drafts = tryAMashDrafts();
		expect(isTryAMashDemoNote(drafts[0]!)).toBe(true);
		expect(isTryAMashDemoNote({ tags: ['other'] })).toBe(false);
		expect(shouldStayOnDeskAfterMash(drafts)).toBe(true);
		expect(shouldStayOnDeskAfterMash([{ tags: [TRY_A_MASH_TAG] }, { tags: [] }])).toBe(false);
		expect(shouldStayOnDeskAfterMash([{ tags: [TRY_A_MASH_TAG] }])).toBe(false);
	});

	it('has short success and after-mash toasts', () => {
		expect(tryAMashSuccessToast()).toMatch(/Both selected/i);
		expect(tryAMashSuccessToast()).toMatch(/Mash/i);
		expect(tryAMashAfterMashToast()).toMatch(/Unmash/i);
		expect(tryAMashAfterMashToast()).toMatch(/Undo/i);
	});
});
