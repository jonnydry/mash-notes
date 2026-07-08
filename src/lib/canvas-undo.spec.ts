import { describe, it, expect } from 'vitest';
import { CanvasUndoStack, spatialNoteOrder, rangeBetween } from './canvas-undo';

describe('canvas-undo', () => {
	it('pushes meaningful layout changes and undoes/redoes', () => {
		const stack = new CanvasUndoStack();
		stack.push({
			label: 'Move',
			before: [{ itemId: 'a', x: 0, y: 0 }],
			after: [{ itemId: 'a', x: 10, y: 0 }]
		});
		expect(stack.canUndo).toBe(true);
		const undone = stack.undo();
		expect(undone?.before[0].x).toBe(0);
		expect(stack.canRedo).toBe(true);
		const redone = stack.redo();
		expect(redone?.after[0].x).toBe(10);
	});

	it('ignores no-op pushes', () => {
		const stack = new CanvasUndoStack();
		stack.push({
			label: 'Move',
			before: [{ itemId: 'a', x: 1, y: 1, w: 10 }],
			after: [{ itemId: 'a', x: 1, y: 1, w: 10 }]
		});
		expect(stack.canUndo).toBe(false);
	});

	it('orders notes spatially and ranges between them', () => {
		const order = spatialNoteOrder([
			{ noteId: 'c', x: 100, y: 0 },
			{ noteId: 'a', x: 0, y: 0 },
			{ noteId: 'b', x: 0, y: 50 }
		]);
		expect(order).toEqual(['a', 'c', 'b']);
		expect(rangeBetween(order, 'a', 'b')).toEqual(['a', 'c', 'b']);
		expect(rangeBetween(order, 'c', 'a')).toEqual(['a', 'c']);
	});
});
