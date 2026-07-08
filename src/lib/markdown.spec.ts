import { describe, it, expect } from 'vitest';
import { extractWikilinks, renderMarkdown, isSafeHref } from './markdown';

describe('markdown', () => {
	it('extracts unique wikilinks', () => {
		expect(extractWikilinks('See [[Alpha]] and [[Beta|B]] and [[Alpha]]')).toEqual([
			'Alpha',
			'Beta'
		]);
	});

	it('renders headings and escapes raw html', () => {
		const html = renderMarkdown('# Hi\n\n<script>alert(1)</script>');
		expect(html).toContain('<h1');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('<script>');
	});

	it('turns wikilinks into buttons', () => {
		const html = renderMarkdown('Go to [[Project ideas]]');
		expect(html).toContain('data-wikilink="Project ideas"');
		expect(html).toContain('class="mash-wikilink"');
		expect(html).toContain('Project ideas');
	});

	it('blocks unsafe href schemes', () => {
		expect(isSafeHref('https://example.com')).toBe(true);
		expect(isSafeHref('/local')).toBe(true);
		expect(isSafeHref('javascript:alert(1)')).toBe(false);
		expect(isSafeHref('JAVASCRIPT:alert(1)')).toBe(false);
		expect(isSafeHref('data:text/html,hi')).toBe(false);
		const html = renderMarkdown('[x](javascript:alert(1))');
		expect(html).toContain('href="#"');
	});
});
