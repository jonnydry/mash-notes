import { describe, it, expect } from 'vitest';
import {
	combineNotes,
	notesToJson,
	slugifyFilename,
	notesFromSelection
} from './mash';
import type { Note } from './types';

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
	return {
		body: '',
		folder: '',
		tags: [],
		created: 1,
		modified: 1,
		pinned: 0,
		...partial
	};
}

describe('combineNotes', () => {
	it('returns empty string for empty selection', () => {
		expect(combineNotes([])).toBe('');
	});

	it('combines a single note with title and body', () => {
		const md = combineNotes([note({ id: '1', title: 'Hello', body: 'World' })]);
		expect(md).toBe('# Hello\n\nWorld');
	});

	it('joins multiple notes with separators', () => {
		const md = combineNotes([
			note({ id: '1', title: 'A', body: 'one' }),
			note({ id: '2', title: 'B', body: 'two' })
		]);
		expect(md).toBe('# A\n\none\n\n---\n\n# B\n\ntwo');
	});

	it('uses Untitled for blank titles and omits empty body blank line', () => {
		const md = combineNotes([note({ id: '1', title: '  ', body: '' })]);
		expect(md).toBe('# Untitled');
	});

	it('preserves caller order', () => {
		const md = combineNotes([
			note({ id: '2', title: 'Second', body: 'b' }),
			note({ id: '1', title: 'First', body: 'a' })
		]);
		expect(md.startsWith('# Second')).toBe(true);
		expect(md.includes('# First')).toBe(true);
	});
});

describe('notesToJson', () => {
	it('pretty-prints notes as JSON', () => {
		const n = note({ id: 'x', title: 'T', body: 'b', tags: ['a'] });
		const parsed = JSON.parse(notesToJson([n]));
		expect(parsed).toHaveLength(1);
		expect(parsed[0].id).toBe('x');
		expect(parsed[0].tags).toEqual(['a']);
	});
});

describe('slugifyFilename', () => {
	it('slugifies titles', () => {
		expect(slugifyFilename('Hello World!')).toBe('hello-world');
	});

	it('falls back when empty', () => {
		expect(slugifyFilename('   ')).toBe('mash-export');
	});
});

describe('notesFromSelection', () => {
	it('resolves ids in selection order and skips missing', () => {
		const notes = [
			note({ id: 'a', title: 'A' }),
			note({ id: 'b', title: 'B' }),
			note({ id: 'c', title: 'C' })
		];
		const selected = notesFromSelection(notes, ['c', 'missing', 'a']);
		expect(selected.map((n) => n.id)).toEqual(['c', 'a']);
	});
});
