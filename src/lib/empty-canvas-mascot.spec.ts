import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	chooseEmptyCanvasMascotForVisit,
	EMPTY_CANVAS_MASCOTS,
	EMPTY_CANVAS_MASCOT_INDEX_KEY
} from './empty-canvas-mascot';

describe('empty canvas mascot rotation', () => {
	it('includes every character asset with a unique encoded URL', () => {
		expect(EMPTY_CANVAS_MASCOTS).toHaveLength(21);
		expect(new Set(EMPTY_CANVAS_MASCOTS.map((mascot) => mascot.src))).toHaveLength(21);
		for (const mascot of EMPTY_CANVAS_MASCOTS) {
			expect(mascot.src).toMatch(/^\/icons\/Rotating%20Icons\/.+\.png$/);
			expect(mascot.src).not.toContain(' ');
			expect(mascot.width).toBe(mascot.height);
			expect(
				existsSync(fileURLToPath(new URL(`../../static${decodeURI(mascot.src)}`, import.meta.url)))
			).toBe(true);
		}
	});

	it('uses the supplied random value for a visit', () => {
		const mascot = chooseEmptyCanvasMascotForVisit({ random: () => 0.5, storage: null });
		expect(mascot).toBe(EMPTY_CANVAS_MASCOTS[Math.floor(EMPTY_CANVAS_MASCOTS.length / 2)]);
	});

	it('can choose the first character when storage has no previous visit', () => {
		const storage = {
			getItem: () => null,
			setItem: () => undefined
		};

		expect(chooseEmptyCanvasMascotForVisit({ random: () => 0, storage })).toBe(
			EMPTY_CANVAS_MASCOTS[0]
		);
	});

	it('avoids showing the same character on two consecutive visits in one tab', () => {
		const values = new Map([[EMPTY_CANVAS_MASCOT_INDEX_KEY, '0']]);
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value)
		};

		const mascot = chooseEmptyCanvasMascotForVisit({ random: () => 0, storage });

		expect(mascot).toBe(EMPTY_CANVAS_MASCOTS[1]);
		expect(values.get(EMPTY_CANVAS_MASCOT_INDEX_KEY)).toBe('1');
	});

	it('still chooses a character when session storage is unavailable', () => {
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
			EMPTY_CANVAS_MASCOTS[0]
		);
	});
});
