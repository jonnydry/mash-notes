import { describe, expect, it } from 'vitest';
import {
	canvasBowlBounds,
	cleanCanvasBowls,
	createBowlMembership,
	removeItemsFromBowls
} from './canvas-bowls';
import type { CanvasBowl, CanvasItem } from './types';

function bowl(id: string, itemIds: string[]): CanvasBowl {
	return { id, name: id, itemIds, created: 1, modified: 1 };
}

function item(id: string, x: number, y: number, w = 220, h = 120): CanvasItem {
	return { id, canvasId: 'c1', noteId: `note-${id}`, x, y, w, h };
}

describe('canvas bowls', () => {
	it('creates one bowl and removes its cards from older bowls', () => {
		const next = createBowlMembership([bowl('old', ['a', 'b', 'c'])], ['b', 'c'], {
			id: 'new',
			name: 'Research',
			now: 10
		});
		expect(next).toEqual([
			{ id: 'new', name: 'Research', itemIds: ['b', 'c'], created: 10, modified: 10 }
		]);
	});

	it('drops stale and duplicate memberships', () => {
		const cleaned = cleanCanvasBowls(
			[bowl('one', ['a', 'b', 'missing']), bowl('two', ['b', 'c'])],
			['a', 'b', 'c']
		);
		expect(cleaned.map((entry) => entry.id)).toEqual(['one']);
		expect(cleaned[0]?.itemIds).toEqual(['a', 'b']);
	});

	it('dissolves a bowl when fewer than two cards remain', () => {
		expect(removeItemsFromBowls([bowl('one', ['a', 'b'])], ['a'])).toEqual([]);
	});

	it('computes a padded oval around its cards', () => {
		const items = [item('a', 100, 80), item('b', 420, 260, 200, 100)];
		const bounds = canvasBowlBounds(bowl('one', ['a', 'b']), items, (entry) => ({
			w: entry.w ?? 220,
			h: entry.h ?? 120
		}));
		expect(bounds).toEqual({ x: 28, y: 16, w: 664, h: 408 });
	});
});
