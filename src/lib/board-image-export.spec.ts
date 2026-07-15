import { describe, expect, it } from 'vitest';
import {
	BOARD_IMAGE_MAX_DIMENSION,
	BOARD_IMAGE_MAX_PIXELS,
	buildBoardImagePlan
} from './board-image-export';
import type { CanvasEdge, CanvasItem, Note } from './types';

function note(id: string, body = `${id} body`): Note {
	return {
		id,
		title: id.toUpperCase(),
		body,
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0
	};
}

function item(
	id: string,
	noteId: string,
	x: number,
	y: number,
	w?: number,
	h?: number
): CanvasItem {
	return { id, noteId, canvasId: 'canvas', x, y, w, h };
}

function edge(id: string, fromItemId: string, toItemId: string): CanvasEdge {
	return { id, canvasId: 'canvas', fromItemId, toItemId, created: 1 };
}

describe('board image plan', () => {
	it('crops to scoped cards and keeps only relationships inside the scope', () => {
		const notes = [note('a'), note('b'), note('c')];
		const plan = buildBoardImagePlan({
			noteIds: ['a', 'b'],
			notesById: new Map(notes.map((row) => [row.id, row])),
			items: [item('ia', 'a', 100, 200), item('ib', 'b', 400, 200), item('ic', 'c', 800, 900)],
			edges: [edge('ab', 'ia', 'ib'), edge('bc', 'ib', 'ic')],
			elements: [
				{
					id: 'visual-ab',
					canvasId: 'canvas',
					version: 1,
					kind: 'arrow',
					start: { type: 'item', itemId: 'ia', anchor: 'auto' },
					end: { type: 'item', itemId: 'ib', anchor: 'auto' },
					label: 'supports',
					color: 'blue',
					zIndex: 1,
					created: 1,
					modified: 1
				},
				{
					id: 'visual-bc',
					canvasId: 'canvas',
					version: 1,
					kind: 'arrow',
					start: { type: 'item', itemId: 'ib', anchor: 'auto' },
					end: { type: 'item', itemId: 'ic', anchor: 'auto' },
					zIndex: 2,
					created: 1,
					modified: 1
				}
			]
		});

		expect(plan?.cards.map((card) => card.noteId)).toEqual(['a', 'b']);
		expect(plan?.edges.map((row) => row.id)).toEqual(['ab']);
		expect(plan?.elements.map((row) => row.id)).toEqual(['visual-ab']);
		expect(plan).toMatchObject({ minX: 52, minY: 152, logicalWidth: 616, logicalHeight: 216 });
	});

	it('arranges unplaced scoped notes below the existing board without overlap', () => {
		const notes = [note('a'), note('b'), note('c')];
		const plan = buildBoardImagePlan({
			noteIds: ['a', 'b', 'c'],
			notesById: new Map(notes.map((row) => [row.id, row])),
			items: [item('ia', 'a', 0, 0)],
			edges: [],
			elements: []
		});

		const [placed, firstSynthetic, secondSynthetic] = plan!.cards;
		expect(placed).toMatchObject({ x: 0, y: 0 });
		expect(firstSynthetic.y).toBeGreaterThanOrEqual(placed.y + placed.h + 48);
		expect(secondSynthetic.x).toBeGreaterThan(firstSynthetic.x + firstSynthetic.w);
	});

	it('bounds oversized boards by dimension and pixel ceilings', () => {
		const notes = [note('a'), note('b')];
		const plan = buildBoardImagePlan({
			noteIds: ['a', 'b'],
			notesById: new Map(notes.map((row) => [row.id, row])),
			items: [item('ia', 'a', 0, 0), item('ib', 'b', 50_000, 30_000)],
			edges: [],
			elements: []
		});

		expect(plan?.downscaled).toBe(true);
		expect(plan!.width).toBeLessThanOrEqual(BOARD_IMAGE_MAX_DIMENSION);
		expect(plan!.height).toBeLessThanOrEqual(BOARD_IMAGE_MAX_DIMENSION);
		expect(plan!.width * plan!.height).toBeLessThanOrEqual(BOARD_IMAGE_MAX_PIXELS);
	});

	it('returns null for an empty or invalid scope', () => {
		expect(
			buildBoardImagePlan({
				noteIds: ['missing'],
				notesById: new Map(),
				items: [],
				edges: [],
				elements: []
			})
		).toBeNull();
	});

	it('includes free arrow endpoints in the exported image bounds and card colors in the plan', () => {
		const plan = buildBoardImagePlan({
			noteIds: ['a'],
			notesById: new Map([['a', note('a')]]),
			items: [{ ...item('ia', 'a', 100, 100), color: 'amber' }],
			edges: [],
			elements: [
				{
					id: 'free',
					canvasId: 'canvas',
					version: 1,
					kind: 'arrow',
					start: { type: 'item', itemId: 'ia', anchor: 'auto' },
					end: { type: 'point', x: 700, y: 500 },
					zIndex: 1,
					created: 1,
					modified: 1
				}
			]
		});
		expect(plan?.cards[0]?.color).toBe('amber');
		expect(plan?.elements).toHaveLength(1);
		expect(plan!.logicalWidth).toBeGreaterThan(600);
		expect(plan!.logicalHeight).toBeGreaterThan(400);
	});
});
