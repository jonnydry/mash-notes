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

	it('records edge-only mutations', () => {
		const stack = new CanvasUndoStack();
		stack.push({
			label: 'Unstitch',
			before: [],
			after: [],
			edgesBefore: [{ id: 'e1', canvasId: 'c', fromItemId: 'a', toItemId: 'b', created: 1 }],
			edgesAfter: []
		});
		expect(stack.canUndo).toBe(true);
		const undone = stack.undo();
		expect(undone?.edgesBefore).toHaveLength(1);
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

	it('prunes entries that reference removed item ids', () => {
		const stack = new CanvasUndoStack();
		stack.push({
			label: 'Move',
			before: [{ itemId: 'a', x: 0, y: 0 }],
			after: [{ itemId: 'a', x: 10, y: 0 }]
		});
		stack.push({
			label: 'Move',
			before: [{ itemId: 'b', x: 0, y: 0 }],
			after: [{ itemId: 'b', x: 5, y: 0 }]
		});
		stack.push({
			label: 'Link',
			before: [{ itemId: 'a', x: 0, y: 0 }],
			after: [{ itemId: 'a', x: 48, y: 0 }],
			edgesBefore: [],
			edgesAfter: [{ id: 'e1', canvasId: 'c', fromItemId: 'a', toItemId: 'c', created: 1 }]
		});
		stack.pruneItemIds(['a']);
		// Layout move of b survives; Link involving a is dropped.
		expect(stack.canUndo).toBe(true);
		expect(stack.undoLabel).toBe('Move');
		const left = stack.undo();
		expect(left?.before[0]?.itemId).toBe('b');
		expect(stack.canUndo).toBe(false);
	});

	it('keeps Link history when pruning an unrelated card', () => {
		const stack = new CanvasUndoStack();
		stack.push({
			label: 'Link',
			before: [
				{ itemId: 'a', x: 0, y: 0 },
				{ itemId: 'lonely', x: 9, y: 9 }
			],
			after: [
				{ itemId: 'a', x: 48, y: 0 },
				{ itemId: 'lonely', x: 9, y: 9 }
			],
			edgesBefore: [],
			edgesAfter: [{ id: 'e1', canvasId: 'c', fromItemId: 'a', toItemId: 'b', created: 1 }]
		});
		stack.pruneItemIds(['lonely']);
		expect(stack.canUndo).toBe(true);
		expect(stack.undoLabel).toBe('Link');
		const entry = stack.undo();
		expect(entry?.before.map((s) => s.itemId)).toEqual(['a']);
		expect(entry?.edgesAfter).toHaveLength(1);
	});
});
