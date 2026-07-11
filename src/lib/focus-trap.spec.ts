import { describe, expect, it } from 'vitest';
import { wrappedFocusIndex } from './focus-trap';

describe('focus trap navigation', () => {
	it('wraps forward and backward at modal boundaries', () => {
		expect(wrappedFocusIndex(2, 3, false)).toBe(0);
		expect(wrappedFocusIndex(0, 3, true)).toBe(2);
	});

	it('enters from outside at the appropriate edge', () => {
		expect(wrappedFocusIndex(-1, 3, false)).toBe(0);
		expect(wrappedFocusIndex(-1, 3, true)).toBe(2);
		expect(wrappedFocusIndex(-1, 0, false)).toBe(-1);
	});
});
