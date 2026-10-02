import type { PasteAnalysis } from './paste-cards';

export type PasteChoiceCopy = {
	/** Offered when our markdown still has its card breaks. Null otherwise. */
	cardsLabel: string | null;
	linesLabel: string;
	paragraphsLabel: string;
	/** Set when the card breaks are gone. Counts then say lines and paragraphs, not cards. */
	cardBreaksNotice: string | null;
};

function countNoun(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function pasteChoiceCopy(analysis: PasteAnalysis): PasteChoiceCopy {
	if (analysis.cardBreaksGone) {
		return {
			cardsLabel: null,
			linesLabel: countNoun(analysis.lines.length, 'line', 'lines'),
			paragraphsLabel: countNoun(analysis.paragraphs.length, 'paragraph', 'paragraphs'),
			cardBreaksNotice: 'The card breaks are gone.'
		};
	}
	return {
		cardsLabel:
			analysis.cards.length > 0
				? `${countNoun(analysis.cards.length, 'card', 'cards')}: ${analysis.cards
						.map((card) => card.title)
						.join(', ')}`
				: null,
		linesLabel: `${analysis.lines.length} line cards`,
		paragraphsLabel: `${analysis.paragraphs.length} paragraph cards`,
		cardBreaksNotice: null
	};
}
