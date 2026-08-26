import { describe, expect, it } from 'vitest';

import { htmlClippingTitle, normalizeHtmlExcerpt } from './html-clipping';

describe('html-clipping', () => {
	it('normalizes whitespace and titles excerpts', () => {
		expect(normalizeHtmlExcerpt('  a \n b  ')).toBe('a b');
		expect(htmlClippingTitle('First sentence. Second.')).toBe('First sentence');
		expect(htmlClippingTitle('')).toBe('HTML excerpt');
	});

	it('respects a custom maxLength cap', () => {
		expect(normalizeHtmlExcerpt('abcdefghij', 4)).toBe('abcd');
	});

	it('applies the default cap (no maxLength) to 12_000 chars', () => {
		const long = 'x'.repeat(20_000);
		expect(normalizeHtmlExcerpt(long).length).toBe(12_000);
	});

	it('falls back to the placeholder for whitespace-only input', () => {
		expect(htmlClippingTitle('   \n\t  ')).toBe('HTML excerpt');
	});

	it('strips a trailing sentence-terminating comma from a short title', () => {
		expect(htmlClippingTitle('Hello world,')).toBe('Hello world');
	});

	it('caps a long, terminator-less excerpt at 72 chars with trailing punctuation stripped', () => {
		const noEnd = 'The quick brown fox jumps over the lazy dog and runs on across bright fields of sunflowers swaying in the warm afternoon breeze gently right now today forever';
		const result = htmlClippingTitle(noEnd);
		expect(result).toHaveLength(72);
		expect(result.startsWith('The quick')).toBe(true);
		expect(result).not.toMatch(/[.!?]/);
		expect(result).not.toMatch(/[,:;]$/);
	});
});
