import { describe, expect, it } from 'vitest';
import {
	draftsFromUrlOnlyText,
	parseHttpUrl,
	urlCardDraft,
	urlCardTitle,
	urlNoteBody,
	urlNoteSource
} from './url-source';

describe('url-source', () => {
	it('parses http(s) URLs and bare www hosts', () => {
		expect(parseHttpUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
		expect(parseHttpUrl('http://example.com')).toBe('http://example.com/');
		expect(parseHttpUrl('www.example.com/a')).toBe('https://www.example.com/a');
		expect(parseHttpUrl('example.com')).toBe(null);
		expect(parseHttpUrl('not a url')).toBe(null);
		expect(parseHttpUrl('https://example.com/path with spaces')).toBe(null);
		expect(parseHttpUrl('ftp://example.com')).toBe(null);
	});

	it('titles cards from hostname', () => {
		expect(urlCardTitle('https://www.example.com/foo')).toBe('example.com');
		expect(urlCardTitle('https://docs.github.com/en')).toBe('docs.github.com');
	});

	it('builds body and source', () => {
		const href = 'https://example.com/x';
		expect(urlNoteBody(href)).toBe('[example.com](https://example.com/x)\n\nhttps://example.com/x');
		expect(urlNoteSource(href)).toEqual({
			kind: 'url',
			title: 'example.com',
			url: href
		});
		expect(urlCardDraft(href).title).toBe('example.com');
	});

	it('detects url-only multi-line pastes', () => {
		const drafts = draftsFromUrlOnlyText(
			'https://a.example/\nhttps://b.example/path\n'
		);
		expect(drafts).toHaveLength(2);
		expect(drafts![0]!.source.url).toBe('https://a.example/');
		expect(drafts![1]!.title).toBe('b.example');
	});

	it('returns null for mixed or empty paste', () => {
		expect(draftsFromUrlOnlyText('')).toBe(null);
		expect(draftsFromUrlOnlyText('https://a.example/\nhello')).toBe(null);
		expect(draftsFromUrlOnlyText('hello\nhttps://a.example/')).toBe(null);
		expect(draftsFromUrlOnlyText('just text')).toBe(null);
	});
});
