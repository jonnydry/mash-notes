/** Canonical canvas card sizes in board-space pixels. */
export const COLLAPSED_CARD = { w: 220, h: 120 } as const;
export const EXPANDED_CARD = { w: 280, h: 220 } as const;
export const AUTO_EXPANDED_CARD_MAX = { w: 400, h: 480 } as const;

const AUTO_SIZE_OVERFLOW_TOLERANCE = 8;
const AUTO_SIZE_BREATHING_ROOM = 12;
const AUTO_SIZE_GRID = 24;

export type ExpandedCardMeasure = {
	w: number;
	h: number;
	contentScrollHeight: number;
	contentClientHeight: number;
};

/**
 * Grow an opened sticky enough to reveal materially more content. Short notes
 * stay at the compact default; very long notes widen once and retain scrolling.
 * This policy only grows—it never overwrites a larger user-chosen size.
 */
export function autoExpandedCardSize(measure: ExpandedCardMeasure): { w: number; h: number } {
	const overflow = Math.max(0, measure.contentScrollHeight - measure.contentClientHeight);
	if (!Number.isFinite(overflow) || overflow <= AUTO_SIZE_OVERFLOW_TOLERANCE) {
		return { w: measure.w, h: measure.h };
	}

	const desiredHeight =
		Math.ceil((measure.h + overflow + AUTO_SIZE_BREATHING_ROOM) / AUTO_SIZE_GRID) * AUTO_SIZE_GRID;
	const h = Math.max(measure.h, Math.min(AUTO_EXPANDED_CARD_MAX.h, desiredHeight));
	const remainingOverflow = Math.max(0, overflow - (h - measure.h));
	const w =
		h >= AUTO_EXPANDED_CARD_MAX.h && remainingOverflow > AUTO_SIZE_OVERFLOW_TOLERANCE
			? Math.max(measure.w, AUTO_EXPANDED_CARD_MAX.w)
			: measure.w;

	return { w, h };
}
