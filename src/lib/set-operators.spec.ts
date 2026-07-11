import { describe, expect, it } from 'vitest';
import type { CanvasItem, Note } from './types';
import {
	deduplicateSet,
	shuffledSetMoves,
	sortedSetMoves,
	spatialSetItems,
	spreadSetMoves,
	stackedSetMoves
} from './set-operators';

const items: CanvasItem[] = [
	{ id: 'b', canvasId: 'c', noteId: 'n2', x: 240, y: 0 },
	{ id: 'a', canvasId: 'c', noteId: 'n1', x: 0, y: 0 },
	{ id: 'c', canvasId: 'c', noteId: 'n3', x: 480, y: 0 }
];
const note = (id: string, title: string, body = '', created = 0): Note => ({
	id,
	title,
	body,
	folder: '',
	tags: [],
	created,
	modified: created,
	pinned: 0
});

describe('set operators', () => {
	it('stacks and spreads cards in stable spatial order', () => {
		expect(spatialSetItems(items).map((item) => item.id)).toEqual(['a', 'b', 'c']);
		expect(stackedSetMoves(items)).toEqual([
			{ itemId: 'a', x: 0, y: 0 },
			{ itemId: 'b', x: 18, y: 16 },
			{ itemId: 'c', x: 36, y: 32 }
		]);
		expect(spreadSetMoves(items)).toEqual([
			{ itemId: 'a', x: 0, y: 0 },
			{ itemId: 'b', x: 244, y: 0 },
			{ itemId: 'c', x: 0, y: 144 }
		]);
	});

	it('sorts cards into their existing spatial slots', () => {
		const notes = new Map([
			['n1', note('n1', 'Zulu', '', 3)],
			['n2', note('n2', 'Alpha', '', 2)],
			['n3', note('n3', 'Middle', '', 1)]
		]);
		expect(sortedSetMoves(items, notes, 'title')).toEqual([
			{ itemId: 'b', x: 0, y: 0 },
			{ itemId: 'c', x: 240, y: 0 },
			{ itemId: 'a', x: 480, y: 0 }
		]);
		expect(sortedSetMoves(items, notes, 'created').map((move) => move.itemId)).toEqual([
			'c',
			'b',
			'a'
		]);
	});

	it('shuffles deterministically with an injected random source', () => {
		const moves = shuffledSetMoves(items, () => 0);
		expect(moves.map((move) => move.itemId)).toEqual(['b', 'c', 'a']);
	});

	it('finds normalized duplicate content while keeping the first spatial card', () => {
		const notes = new Map([
			['n1', note('n1', ' Same ', 'Hello   world')],
			['n2', note('n2', 'same', 'hello world')],
			['n3', note('n3', 'Different', 'hello world')]
		]);
		expect(deduplicateSet(items, notes)).toEqual({
			keepItemIds: ['a', 'c'],
			removeItemIds: ['b'],
			keepNoteIds: ['n1', 'n3']
		});
	});
});
