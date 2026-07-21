import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	acknowledgeEmptyCanvasMascotDisplay,
	chooseEmptyCanvasMascotForVisit,
	DEFAULT_EMPTY_CANVAS_MASCOT,
	EMPTY_CANVAS_MASCOTS,
	EMPTY_CANVAS_MASCOT_INDEX_KEY,
	EMPTY_CANVAS_MASCOT_SEEN_KEY
} from './empty-canvas-mascot';

function memoryStorage(initial: Array<[string, string]> = []) {
	const values = new Map(initial);
	return {
		values,
		storage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value)
		}
	};
}

describe('empty canvas mascot rotation', () => {
	it('includes every later-visit character once without duplicating the core potato', () => {
		expect(EMPTY_CANVAS_MASCOTS).toHaveLength(21);
		expect(new Set(EMPTY_CANVAS_MASCOTS.map((mascot) => mascot.src))).toHaveLength(21);
		for (const mascot of EMPTY_CANVAS_MASCOTS) {
			expect(mascot.src).toMatch(/^\/icons\/Rotating%20Icons\/.+\.png$/);
			expect(mascot.src).not.toContain('/mash-empty-mascot.png');
			expect(mascot.src).not.toContain(' ');
			expect(mascot.width).toBeGreaterThan(0);
			expect(mascot.height).toBeGreaterThan(0);
			expect(mascot.rotationIndex).toBeGreaterThanOrEqual(0);
			expect(
				existsSync(fileURLToPath(new URL(`../../static${decodeURI(mascot.src)}`, import.meta.url)))
			).toBe(true);
		}
	});

	it('always chooses the core potato until its image has successfully displayed', () => {
		const { values, storage } = memoryStorage();

		expect(chooseEmptyCanvasMascotForVisit({ random: () => 0.75, storage })).toBe(
			DEFAULT_EMPTY_CANVAS_MASCOT
		);
		expect(values.get(EMPTY_CANVAS_MASCOT_SEEN_KEY)).toBeUndefined();

		acknowledgeEmptyCanvasMascotDisplay(DEFAULT_EMPTY_CANVAS_MASCOT, storage);
		expect(values.get(EMPTY_CANVAS_MASCOT_SEEN_KEY)).toBe('1');
	});

	it('uses the supplied random value after the default has been seen', () => {
		const { storage } = memoryStorage([[EMPTY_CANVAS_MASCOT_SEEN_KEY, '1']]);
		const mascot = chooseEmptyCanvasMascotForVisit({ random: () => 0.5, storage });
		expect(mascot).toBe(EMPTY_CANVAS_MASCOTS[Math.floor(EMPTY_CANVAS_MASCOTS.length / 2)]);
	});

	it('avoids the last successfully displayed rotating character', () => {
		const { values, storage } = memoryStorage([
			[EMPTY_CANVAS_MASCOT_SEEN_KEY, '1'],
			[EMPTY_CANVAS_MASCOT_INDEX_KEY, '0']
		]);

		const mascot = chooseEmptyCanvasMascotForVisit({ random: () => 0, storage });

		expect(mascot).toBe(EMPTY_CANVAS_MASCOTS[1]);
		// Merely choosing an image does not advance durable rotation state.
		expect(values.get(EMPTY_CANVAS_MASCOT_INDEX_KEY)).toBe('0');
		acknowledgeEmptyCanvasMascotDisplay(mascot, storage);
		expect(values.get(EMPTY_CANVAS_MASCOT_INDEX_KEY)).toBe('1');
	});

	it('uses the core potato safely when local storage is unavailable', () => {
		const storage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};

		expect(() => chooseEmptyCanvasMascotForVisit({ random: () => 0, storage })).not.toThrow();
		expect(chooseEmptyCanvasMascotForVisit({ random: () => 0, storage })).toBe(
			DEFAULT_EMPTY_CANVAS_MASCOT
		);
		expect(() =>
			acknowledgeEmptyCanvasMascotDisplay(DEFAULT_EMPTY_CANVAS_MASCOT, storage)
		).not.toThrow();
	});
});
