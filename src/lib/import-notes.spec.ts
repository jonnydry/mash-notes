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
});
