import { describe, expect, it } from 'vitest';
import {
	convertHtmlFile,
	extractHtmlDocumentTitle,
	htmlTitleFromFileName,
	isHtmlFile,
	sanitizeHtmlFragment
} from './html-import';

describe('html-import', () => {
	it('detects html files', () => {
		expect(isHtmlFile({ name: 'page.html', type: '' })).toBe(true);
		expect(isHtmlFile({ name: 'page.HTM', type: '' })).toBe(true);
		expect(isHtmlFile({ name: 'x', type: 'text/html' })).toBe(true);
		expect(isHtmlFile({ name: 'x.md', type: 'text/markdown' })).toBe(false);
	});

	it('titles from filename and <title>', () => {
		expect(htmlTitleFromFileName('notes.html')).toBe('notes');
		expect(extractHtmlDocumentTitle('<html><title> Hello </title></html>', 'x.html')).toBe('Hello');
		expect(extractHtmlDocumentTitle('<html><body>no title</body></html>', 'brief.html')).toBe(
			'brief'
		);
	});

	it('strips scripts and event handlers', () => {
		const cleaned = sanitizeHtmlFragment(
			'<p onclick="alert(1)">Hi</p><script>evil()</script><p>Ok</p>'
		);
		expect(cleaned.toLowerCase()).not.toContain('<script');
		expect(cleaned.toLowerCase()).not.toContain('onclick');
		expect(cleaned).toContain('Hi');
		expect(cleaned).toContain('Ok');
	});

	it('keeps malformed active markup inert in the non-browser fallback', () => {
		const cleaned = sanitizeHtmlFragment(
			'<script>first()</script\t\n data-junk><scr<script>ipt>second()</scr</script>ipt>'
		);
		expect(cleaned.toLowerCase()).not.toContain('<script');
		expect(cleaned.toLowerCase()).not.toContain('</script');
		expect(cleaned).toContain('first()');
		expect(cleaned).toContain('second()');
	});

	it('strips javascript and data href/src values', () => {
		const cleaned = sanitizeHtmlFragment(
			'<a href="javascript:alert(1)">x</a><a href="data:text/html,hi">y</a><a href="//evil.example">z</a><img src="data:image/png;base64,abc" />'
		);
		expect(cleaned.toLowerCase()).not.toContain('javascript:');
		expect(cleaned.toLowerCase()).not.toContain('href="data:');
		expect(cleaned.toLowerCase()).not.toContain('href="//evil');
		expect(cleaned.toLowerCase()).not.toContain('src="data:');
	});

	it('blocks automatic remote loads and presentation attributes', () => {
		const cleaned = sanitizeHtmlFragment(
			'<img src="https://tracker.example/pixel"><p style="background:url(https://tracker.example/x)" class="fake-ui">Text</p>'
		);
		expect(cleaned).not.toContain('tracker.example');
		expect(cleaned).not.toContain('style=');
		expect(cleaned).not.toContain('class=');
		expect(cleaned).toContain('Text');
	});

	it('removes active foreign markup while retaining ordinary text', () => {
		const cleaned = sanitizeHtmlFragment(
			'<custom-card>Readable</custom-card><svg><a href="javascript:alert(1)"><text>x</text></a></svg>'
		);
		expect(cleaned).toContain('Readable');
		expect(cleaned.toLowerCase()).not.toContain('<svg');
		expect(cleaned.toLowerCase()).not.toContain('javascript:');
	});

	it('allows safe raster data images only when explicitly requested', () => {
		const png = 'data:image/png;base64,aGVsbG8=';
		const cleaned = sanitizeHtmlFragment(`<img src="${png}"><a href="${png}">x</a>`, {
			allowDataImages: true
		});
		expect(cleaned).toContain(png);
		expect(cleaned).not.toContain(`href="${png}"`);
		expect(
			sanitizeHtmlFragment('<img src="data:image/svg+xml;base64,PHN2Zz4=">', {
				allowDataImages: true
			})
		).not.toContain('data:image/svg');
	});

	it('converts a small html blob', async () => {
		const file = new File(
			['<!doctype html><html><title>Demo</title><body><p>Hello desk</p></body></html>'],
			'demo.html',
			{ type: 'text/html' }
		);
		const result = await convertHtmlFile(file);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.title).toBe('Demo');
			expect(result.html).toContain('Hello desk');
		}
	});
});
