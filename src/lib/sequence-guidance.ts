export type SequencePageBadge = {
	sequence: number;
	page: number;
};

export type SequenceGuidance = {
	prompt: string;
	currentPage: number | null;
	nextPage: number | null;
	canFinish: boolean;
};

/** Copy and numbering for the manual Set page order mode. */
export function sequenceGuidance(
	active: boolean,
	sourceItemId: string | null,
	badges: ReadonlyMap<string, SequencePageBadge>
): SequenceGuidance {
	if (!active) {
		return {
			prompt: 'Set page order',
			currentPage: null,
			nextPage: null,
			canFinish: false
		};
	}
	if (!sourceItemId) {
		return {
			prompt: 'Choose the first page',
			currentPage: null,
			nextPage: 1,
			canFinish: false
		};
	}

	const currentPage = badges.get(sourceItemId)?.page ?? 1;
	return {
		prompt: `Choose page ${currentPage + 1}`,
		currentPage,
		nextPage: currentPage + 1,
		canFinish: currentPage >= 2
	};
}
