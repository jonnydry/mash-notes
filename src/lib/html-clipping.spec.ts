import { describe, expect, it } from 'vitest';
import { htmlClippingTitle, normalizeHtmlExcerpt } from './html-clipping';

describe('html-clipping', () => {
	it('normalizes whitespace and titles excerpts', () => {
		expect(normalizeHtmlExcerpt('  a \n b  ')).toBe('a b');
		expect(htmlClippingTitle('First sentence. Second.')).toBe('First sentence');
		expect(htmlClippingTitle('')).toBe('HTML excerpt');
	});
});
