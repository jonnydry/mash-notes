import { describe, expect, it } from 'vitest';
import type { Note } from './types';
import { splitNoteFragments } from './split-content';

const note = (body: string): Note => ({
	id: 'source',
	title: 'Source',
	body,
	folder: '',
	tags: [],
	created: 1,
	modified: 1,
	pinned: 0
});

describe('content splitting', () => {
	it('splits markdown heading sections and keeps prelude with the first section', () => {
		expect(
			splitNoteFragments(note('Context\n\n## Alpha\nFirst\n\n## Beta\nSecond'), 'headings')
		).toEqual([
			{ title: 'Alpha', body: 'Context\n\nFirst' },
			{ title: 'Beta', body: 'Second' }
		]);
	});

	it('splits paragraphs and derives compact titles', () => {
		expect(
			splitNoteFragments(note('First idea\nwith detail\n\nSecond idea'), 'paragraphs')
		).toEqual([
			{ title: 'First idea', body: 'First idea\nwith detail' },
			{ title: 'Second idea', body: 'Second idea' }
		]);
	});

	it('splits meaningful lines and strips list markers from titles', () => {
		expect(splitNoteFragments(note('- Alpha\n\n2. Beta'), 'lines')).toEqual([
			{ title: 'Alpha', body: '- Alpha' },
			{ title: 'Beta', body: '2. Beta' }
		]);
	});

	it('returns an empty list for an empty body in every mode', () => {
		const emptyNote = note('');
		expect(splitNoteFragments(emptyNote, 'headings')).toEqual([]);
		expect(splitNoteFragments(emptyNote, 'paragraphs')).toEqual([]);
		expect(splitNoteFragments(emptyNote, 'lines')).toEqual([]);
	});

	it('returns an empty list for a whitespace-only body', () => {
		expect(splitNoteFragments(note('  \n\t  '), 'paragraphs')).toEqual([]);
	});

	it('returns [] in headings mode when the body has no headings', () => {
		expect(splitNoteFragments(note('Just prose\n\nMore prose'), 'headings')).toEqual([]);
	});

	it('splits headings on CRLF the same way it does on LF', () => {
		expect(
			splitNoteFragments(
				note('Context\r\n\r\n## Alpha\r\nFirst\r\n\r\n## Beta\r\nSecond'),
				'headings'
			)
		).toEqual([
			{ title: 'Alpha', body: 'Context\n\nFirst' },
			{ title: 'Beta', body: 'Second' }
		]);
	});
});
