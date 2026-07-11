import { describe, it, expect } from 'vitest';
import {
	composeEmbeddedNoteImage,
	extractWikilinks,
	isSafeHref,
	isSafeImageSrc,
	parseEmbeddedNoteImage,
	renderMarkdown
} from './markdown';

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

	it('allows data-image clipping sources in markdown images', () => {
		expect(isSafeImageSrc('data:image/png;base64,abc')).toBe(true);
		expect(isSafeImageSrc('data:text/html,hi')).toBe(false);
		const html = renderMarkdown('![clip](data:image/png;base64,abc)');
		expect(html).toContain('src="data:image/png;base64,abc"');
		expect(html).toContain('alt="clip"');
		const blocked = renderMarkdown('![x](javascript:alert(1))');
		expect(blocked).not.toContain('javascript:');
	});

	it('parses and rebuilds leading embedded note images', () => {
		const body =
			'![PDF clipping from page 3](data:image/png;base64,abc)\n\n_From Scales.pdf, page 3._';
		expect(parseEmbeddedNoteImage(body)).toEqual({
			alt: 'PDF clipping from page 3',
			src: 'data:image/png;base64,abc',
			caption: '_From Scales.pdf, page 3._'
		});
		expect(composeEmbeddedNoteImage('clip', 'data:image/png;base64,abc', 'note')).toBe(
			'![clip](data:image/png;base64,abc)\n\nnote'
		);
		expect(parseEmbeddedNoteImage('just text')).toBeNull();
		expect(parseEmbeddedNoteImage('![x](javascript:alert(1))')).toBeNull();
	});
});
