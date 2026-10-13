import { readFileSync } from 'node:fs';
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

	it('loads marked from the deferred runtime, not a static import', () => {
		const markdown = readFileSync(new URL('./markdown.ts', import.meta.url), 'utf8');
		const nodes = readFileSync(new URL('./markdown-nodes.ts', import.meta.url), 'utf8');
		const runtime = readFileSync(new URL('./marked-runtime.ts', import.meta.url), 'utf8');
		expect(markdown).not.toMatch(/from ['"]marked['"]/);
		expect(nodes).not.toMatch(/from ['"]marked['"]/);
		expect(markdown).toContain("import('./marked-runtime')");
		expect(nodes).toContain("import('./marked-runtime')");
		expect(runtime).toContain("from 'marked'");
	});

	it('renders headings and escapes raw html', async () => {
		const html = await renderMarkdown('# Hi\n\n<script>alert(1)</script>');
		expect(html).toContain('<h1');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('<script>');
	});

	it('turns wikilinks into buttons', async () => {
		const html = await renderMarkdown('Go to [[Project ideas]]');
		expect(html).toContain('data-wikilink="Project ideas"');
		expect(html).toContain('class="mash-wikilink"');
		expect(html).toContain('Project ideas');
	});

	it('blocks unsafe href schemes', async () => {
		expect(isSafeHref('https://example.com')).toBe(true);
		expect(isSafeHref('/local')).toBe(true);
		expect(isSafeHref('javascript:alert(1)')).toBe(false);
		expect(isSafeHref('JAVASCRIPT:alert(1)')).toBe(false);
		expect(isSafeHref('data:text/html,hi')).toBe(false);
		expect(isSafeHref('//evil.example/phish')).toBe(false);
		const html = await renderMarkdown('[x](javascript:alert(1))');
		expect(html).toContain('href="#"');
		const protocolRelative = await renderMarkdown('[x](//evil.example)');
		expect(protocolRelative).toContain('href="#"');
	});

	it('allows data-image clipping sources in markdown images', async () => {
		expect(isSafeImageSrc('data:image/png;base64,abc')).toBe(true);
		expect(isSafeImageSrc('data:text/html,hi')).toBe(false);
		expect(isSafeImageSrc('mash-blob:abc-12345')).toBe(true);
		expect(isSafeImageSrc('mash-blob:../evil')).toBe(false);
		const html = await renderMarkdown('![clip](data:image/png;base64,abc)');
		expect(html).toContain('src="data:image/png;base64,abc"');
		expect(html).toContain('alt="clip"');
		const blobHtml = await renderMarkdown('![clip](mash-blob:abc-12345)');
		expect(blobHtml).toContain('src="mash-blob:abc-12345"');
		const blocked = await renderMarkdown('![x](javascript:alert(1))');
		expect(blocked).not.toContain('javascript:');
		expect(isSafeImageSrc('https://tracker.example/pixel.png')).toBe(false);
		expect(await renderMarkdown('![tracker](https://tracker.example/pixel.png)')).not.toContain(
			'tracker.example'
		);
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
