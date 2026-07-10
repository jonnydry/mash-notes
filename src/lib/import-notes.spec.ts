import { describe, it, expect } from 'vitest';
import { parseNotesJson } from './import-notes';

describe('import-notes', () => {
	it('parses a valid export', () => {
		const json = JSON.stringify([
			{
				id: 'a',
				title: 'Hello',
				body: 'World',
				folder: '',
				tags: ['x'],
				created: 1,
				modified: 2,
				pinned: 0
			}
		]);
		const result = parseNotesJson(json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.notes).toHaveLength(1);
			expect(result.notes[0].title).toBe('Hello');
		}
	});

	it('rejects non-arrays and bad json', () => {
		expect(parseNotesJson('{}').ok).toBe(false);
		expect(parseNotesJson('not json').ok).toBe(false);
	});

	it('preserves textAlign when present', () => {
		const json = JSON.stringify([
			{
				id: 'a',
				title: 'Centered',
				body: 'Hi',
				folder: '',
				tags: [],
				created: 1,
				modified: 2,
				pinned: 0,
				textAlign: 'center'
			}
		]);
		const result = parseNotesJson(json);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.notes[0].textAlign).toBe('center');
	});

	it('preserves validated PDF provenance', () => {
		const json = JSON.stringify([
			{
				id: 'pdf-note',
				title: 'Useful excerpt',
				body: 'Selected text',
				folder: '',
				tags: ['pdf-clipping'],
				created: 1,
				modified: 2,
				pinned: 0,
				source: { kind: 'pdf', title: 'paper.pdf', page: 12 }
			}
		]);
		const result = parseNotesJson(json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.notes[0].source).toEqual({ kind: 'pdf', title: 'paper.pdf', page: 12 });
		}
	});
});
