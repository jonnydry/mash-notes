import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	GIF_EXPLODE_MAX_FRAMES,
	gifFrameDraft,
	gifFrameTitle,
	inspectGif,
	isGifFile,
	sampleFrameIndices
} from './gif-explode';

const fixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../e2e/fixtures/two-frame.gif'
);

describe('gif-explode helpers', () => {
	it('detects gif files', () => {
		expect(isGifFile({ name: 'a.gif', type: '' })).toBe(true);
		expect(isGifFile({ name: 'a.GIF', type: '' })).toBe(true);
		expect(isGifFile({ name: 'x', type: 'image/gif' })).toBe(true);
		expect(isGifFile({ name: 'a.png', type: 'image/png' })).toBe(false);
	});

	it('samples frame indices evenly', () => {
		expect(sampleFrameIndices(5, 36)).toEqual([0, 1, 2, 3, 4]);
		expect(sampleFrameIndices(1, 36)).toEqual([0]);
		expect(sampleFrameIndices(0, 36)).toEqual([]);
		expect(sampleFrameIndices(100, 1)).toEqual([0]);
		const sampled = sampleFrameIndices(100, 10);
		expect(sampled).toHaveLength(10);
		expect(sampled[0]).toBe(0);
		expect(sampled[sampled.length - 1]).toBe(99);
		// strictly increasing
		for (let i = 1; i < sampled.length; i++) {
			expect(sampled[i]!).toBeGreaterThan(sampled[i - 1]!);
		}
	});

	it('labels frames for the desk', () => {
		expect(gifFrameTitle('dance', 3, 12)).toBe('dance · f. 3');
		expect(gifFrameTitle('dance', 1, 1)).toBe('dance');
		expect(gifFrameDraft('data:image/png;base64,xx', 'dance', 2, 8).title).toBe('dance · f. 2');
		expect(gifFrameDraft('data:image/png;base64,xx', 'dance', 2, 8).source).toEqual({
			kind: 'image',
			title: 'dance · f. 2/8'
		});
	});

	it('exports a sensible frame cap', () => {
		expect(GIF_EXPLODE_MAX_FRAMES).toBe(36);
	});

	it('inspects an animated gif fixture', async () => {
		const bytes = readFileSync(fixturePath);
		const blob = new Blob([bytes], { type: 'image/gif' });
		const result = await inspectGif(blob);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.animated).toBe(true);
			expect(result.frameCount).toBeGreaterThanOrEqual(2);
		}
	});
});
