import { describe, expect, it } from 'vitest';
import { bodyForSearchIndex } from './search';

describe('bodyForSearchIndex', () => {
	it('strips data-url image payloads and keeps alt/caption', () => {
		const body =
			'![Chart of sales](data:image/png;base64,' + 'A'.repeat(50_000) + ')\n\n_From board photo_';
		const indexed = bodyForSearchIndex(body);
		expect(indexed.length).toBeLessThan(500);
		expect(indexed.toLowerCase()).toContain('chart');
		expect(indexed.toLowerCase()).toContain('board');
		expect(indexed).not.toContain('base64');
		expect(indexed).not.toMatch(/A{100}/);
	});

	it('caps long plain text bodies', () => {
		const body = 'word '.repeat(10_000);
		expect(bodyForSearchIndex(body).length).toBeLessThanOrEqual(8_000);
	});
});
