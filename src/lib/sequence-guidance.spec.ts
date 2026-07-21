import { describe, expect, it } from 'vitest';
import { sequenceGuidance, type SequencePageBadge } from './sequence-guidance';

function badges(entries: Array<[string, SequencePageBadge]>) {
	return new Map(entries);
}

describe('sequenceGuidance', () => {
	it('names the inactive manual action', () => {
		expect(sequenceGuidance(false, null, badges([]))).toEqual({
			prompt: 'Set page order',
			currentPage: null,
			nextPage: null,
			canFinish: false
		});
	});

	it('asks for the first page when the mode begins', () => {
		expect(sequenceGuidance(true, null, badges([])).prompt).toBe('Choose the first page');
	});

	it('treats an uncommitted source as provisional page one', () => {
		expect(sequenceGuidance(true, 'a', badges([]))).toMatchObject({
			prompt: 'Choose page 2',
			currentPage: 1,
			nextPage: 2,
			canFinish: false
		});
	});

	it('advances from a committed page and offers Done after page two', () => {
		expect(sequenceGuidance(true, 'b', badges([['b', { sequence: 1, page: 2 }]]))).toMatchObject({
			prompt: 'Choose page 3',
			currentPage: 2,
			nextPage: 3,
			canFinish: true
		});
	});
});
