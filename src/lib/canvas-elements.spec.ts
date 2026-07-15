import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
	canvasElementBindsItem,
	cleanCanvasElements,
	cloneCanvasElement,
	remapCanvasElement
} from './canvas-elements';
import {
	addCanvasElement,
	db,
	listCanvasElements,
	removeCanvasItem,
	replaceCanvasItemSubset,
	updateCanvasElement,
	updateCanvasItemColor
} from './db';
import type { CanvasElement, CanvasItem } from './types';

function arrow(partial: Partial<CanvasElement> = {}): CanvasElement {
	return {
		id: 'arrow-1',
		canvasId: 'canvas-1',
		version: 1,
		kind: 'arrow',
		start: { type: 'item', itemId: 'item-1', anchor: 'right' },
		end: { type: 'point', x: 400, y: 180 },
		zIndex: 1,
		created: 10,
		modified: 10,
		...partial
	};
}

describe('canvas elements', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('clones endpoints and remaps bound card ids without mutating the source', () => {
		const source = arrow({
			end: { type: 'item', itemId: 'item-2', anchor: 'left' },
			label: 'Depends on'
		});
		const clone = cloneCanvasElement(source);
		expect(clone).toEqual(source);
		expect(clone.start).not.toBe(source.start);
		expect(clone.end).not.toBe(source.end);

		const remapped = remapCanvasElement(
			source,
			'local-canvas',
			new Map([
				['item-1', 'local-1'],
				['item-2', 'local-2']
			]),
			'local-arrow'
		);
		expect(remapped).toMatchObject({
			id: 'local-arrow',
			canvasId: 'local-canvas',
			start: { type: 'item', itemId: 'local-1' },
			end: { type: 'item', itemId: 'local-2' }
		});
		expect(source.start).toMatchObject({ itemId: 'item-1' });
	});

	it('drops elements with missing or cross-canvas bindings', () => {
		const items: CanvasItem[] = [
			{ id: 'item-1', canvasId: 'canvas-1', noteId: 'note-1', x: 0, y: 0 },
			{ id: 'item-2', canvasId: 'canvas-2', noteId: 'note-2', x: 0, y: 0 }
		];
		const valid = arrow();
		const crossCanvas = arrow({
			id: 'arrow-2',
			end: { type: 'item', itemId: 'item-2', anchor: 'left' }
		});
		const missing = arrow({
			id: 'arrow-3',
			start: { type: 'item', itemId: 'gone', anchor: 'auto' }
		});
		expect(
			cleanCanvasElements([valid, crossCanvas, missing], new Set(['canvas-1']), items)
		).toEqual([valid]);
	});

	it('persists appearance and removes only arrows bound to a deleted card', async () => {
		await db.canvases.put({
			id: 'canvas-1',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 1
		});
		await db.canvasItems.put({
			id: 'item-1',
			canvasId: 'canvas-1',
			noteId: 'note-1',
			x: 0,
			y: 0
		});
		await updateCanvasItemColor('item-1', 'amber');
		expect((await db.canvasItems.get('item-1'))?.color).toBe('amber');

		await addCanvasElement(arrow());
		await addCanvasElement(
			arrow({
				id: 'free-arrow',
				start: { type: 'point', x: 20, y: 20 },
				end: { type: 'point', x: 200, y: 100 }
			})
		);
		const updated = await updateCanvasElement('arrow-1', {
			label: 'Leads to',
			color: 'blue',
			stroke: 'dashed'
		});
		expect(updated).toMatchObject({ label: 'Leads to', color: 'blue', stroke: 'dashed' });
		expect(canvasElementBindsItem(updated!, 'item-1')).toBe(true);

		await removeCanvasItem('item-1');
		expect(await listCanvasElements('canvas-1')).toEqual([
			expect.objectContaining({ id: 'free-arrow' })
		]);
	});

	it('rejects a durable arrow when one of its card bindings is invalid', async () => {
		await db.canvases.put({
			id: 'canvas-1',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 1
		});
		await expect(addCanvasElement(arrow())).rejects.toThrow('broken card binding');
		expect(await db.canvasElements.count()).toBe(0);
	});

	it('removes orphaned bindings when a content operation replaces card membership', async () => {
		await db.canvases.put({
			id: 'canvas-1',
			folder: '',
			title: 'Desk',
			created: 1,
			modified: 1
		});
		await db.canvasItems.put({
			id: 'item-1',
			canvasId: 'canvas-1',
			noteId: 'note-1',
			x: 0,
			y: 0
		});
		await addCanvasElement(arrow());
		await replaceCanvasItemSubset(
			'canvas-1',
			['item-1', 'replacement'],
			[
				{
					id: 'replacement',
					canvasId: 'canvas-1',
					noteId: 'note-2',
					x: 40,
					y: 40
				}
			]
		);
		expect(await listCanvasElements('canvas-1')).toEqual([]);
	});
});
