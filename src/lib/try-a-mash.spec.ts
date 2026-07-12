import { describe, expect, it } from 'vitest';
import {
	TRY_A_MASH_DISMISSED_KEY,
	TRY_A_MASH_TAG,
	dismissTryAMash,
	isTryAMashDismissed,
	shouldOfferTryAMash,
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

	it('only offers on empty non-pinned boards when not dismissed', () => {
		expect(
			shouldOfferTryAMash({ dismissed: false, emptyStateVisible: true, isPinnedBoard: false })
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
	});

	it('has a short success toast', () => {
		expect(tryAMashSuccessToast()).toMatch(/Both selected/i);
		expect(tryAMashSuccessToast()).toMatch(/Mash/i);
	});
});
