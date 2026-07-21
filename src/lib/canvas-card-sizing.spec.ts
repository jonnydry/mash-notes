import { describe, expect, it } from 'vitest';
import { autoExpandedCardSize, AUTO_EXPANDED_CARD_MAX, EXPANDED_CARD } from './canvas-card-sizing';

describe('autoExpandedCardSize', () => {
	it('keeps short notes at the compact expanded size', () => {
		expect(
			autoExpandedCardSize({
				...EXPANDED_CARD,
				contentScrollHeight: 104,
				contentClientHeight: 100
			})
		).toEqual(EXPANDED_CARD);
	});

	it('grows medium notes vertically on the board grid', () => {
		expect(
			autoExpandedCardSize({
				...EXPANDED_CARD,
				contentScrollHeight: 220,
				contentClientHeight: 100
			})
		).toEqual({ w: EXPANDED_CARD.w, h: 360 });
	});

	it('widens very long notes at the capped automatic height', () => {
		expect(
			autoExpandedCardSize({
				...EXPANDED_CARD,
				contentScrollHeight: 540,
				contentClientHeight: 100
			})
		).toEqual(AUTO_EXPANDED_CARD_MAX);
	});

	it('never shrinks an existing larger size', () => {
		expect(
			autoExpandedCardSize({
				w: 520,
				h: 600,
				contentScrollHeight: 900,
				contentClientHeight: 500
			})
		).toEqual({ w: 520, h: 600 });
	});
});
