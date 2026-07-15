import { describe, expect, it } from 'vitest';
import { canvasArrowPath, resolveCanvasArrowEndpoint } from './canvas-element-geometry';
import type { CanvasArrowElement } from './types';

const rects = new Map([
	['left', { x: 20, y: 40, w: 200, h: 120 }],
	['right', { x: 420, y: 60, w: 200, h: 120 }]
]);

describe('canvas element geometry', () => {
	it('resolves automatic bindings to the facing card edges', () => {
		expect(
			resolveCanvasArrowEndpoint(
				{ type: 'item', itemId: 'left', anchor: 'auto' },
				{ x: 520, y: 120 },
				rects
			)
		).toEqual({ x: 220, y: 100 });
		expect(
			resolveCanvasArrowEndpoint(
				{ type: 'item', itemId: 'right', anchor: 'auto' },
				{ x: 120, y: 100 },
				rects
			)
		).toEqual({ x: 420, y: 120 });
	});

	it('builds a selectable path for bound and free endpoints', () => {
		const arrow: CanvasArrowElement = {
			id: 'arrow',
			canvasId: 'canvas',
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: 'left', anchor: 'auto' },
			end: { type: 'point', x: 360, y: 260 },
			zIndex: 1,
			created: 1,
			modified: 1
		};
		const path = canvasArrowPath(arrow, rects);
		expect(path?.start).toEqual({ x: 120, y: 160 });
		expect(path?.end).toEqual({ x: 360, y: 260 });
		expect(path?.d).toContain(' C ');
	});

	it('skips arrows with missing bindings', () => {
		const arrow: CanvasArrowElement = {
			id: 'arrow',
			canvasId: 'canvas',
			version: 1,
			kind: 'arrow',
			start: { type: 'item', itemId: 'missing', anchor: 'auto' },
			end: { type: 'point', x: 1, y: 2 },
			zIndex: 1,
			created: 1,
			modified: 1
		};
		expect(canvasArrowPath(arrow, rects)).toBeNull();
	});
});
