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
		expect(extractHtmlDocumentTitle('<html><title> Hello </title></html>', 'x.html')).toBe(
			'Hello'
		);
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

	it('strips javascript and data href/src values', () => {
		const cleaned = sanitizeHtmlFragment(
			'<a href="javascript:alert(1)">x</a><a href="data:text/html,hi">y</a><a href="//evil.example">z</a><img src="data:image/png;base64,abc" />'
		);
		expect(cleaned.toLowerCase()).not.toContain('javascript:');
		expect(cleaned.toLowerCase()).not.toContain('href="data:');
		expect(cleaned.toLowerCase()).not.toContain('href="//evil');
		expect(cleaned.toLowerCase()).not.toContain('src="data:');
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
