import { describe, expect, it } from 'vitest';
import { rotatedCanvasSize } from './image-rotate';

describe('image rotation', () => {
	it('swaps dimensions for odd quarter turns', () => {
		expect(rotatedCanvasSize(200, 100, 1)).toEqual({ width: 100, height: 200 });
		expect(rotatedCanvasSize(200, 100, -1)).toEqual({ width: 100, height: 200 });
		expect(rotatedCanvasSize(200, 100, 2)).toEqual({ width: 200, height: 100 });
		expect(rotatedCanvasSize(200, 100, 4)).toEqual({ width: 200, height: 100 });
	});
});
