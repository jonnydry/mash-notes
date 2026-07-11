import { describe, expect, it } from 'vitest';
import { docxClippingTitle, normalizeDocxExcerpt } from './docx-clipping';

describe('docx-clipping', () => {
	it('normalizes whitespace and caps length', () => {
		expect(normalizeDocxExcerpt('  hello   world  ')).toBe('hello world');
		expect(normalizeDocxExcerpt('x'.repeat(20_000)).length).toBe(12_000);
	});

	it('builds a short title from excerpt text', () => {
		expect(docxClippingTitle('First sentence. More.')).toBe('First sentence');
		expect(docxClippingTitle('')).toBe('Word excerpt');
	});
});
