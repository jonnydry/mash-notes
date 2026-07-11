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

	it('preserves validated docx provenance', () => {
		const json = JSON.stringify([
			{
				id: 'docx-note',
				title: 'Useful excerpt',
				body: 'Selected text',
				folder: '',
				tags: ['docx-clipping'],
				created: 1,
				modified: 2,
				pinned: 0,
				source: { kind: 'docx', title: 'brief.docx' }
			}
		]);
		const result = parseNotesJson(json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.notes[0].source).toEqual({ kind: 'docx', title: 'brief.docx' });
		}
	});

	it('preserves validated image provenance', () => {
		const json = JSON.stringify([
			{
				id: 'image-note',
				title: 'Screenshot',
				body: '![Screenshot](data:image/png;base64,abc)',
				folder: '',
				tags: [],
				created: 1,
				modified: 2,
				pinned: 0,
				source: { kind: 'image', title: 'shot.png' }
			}
		]);
		const result = parseNotesJson(json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.notes[0].source).toEqual({ kind: 'image', title: 'shot.png' });
		}
	});

	it('preserves validated url provenance', () => {
		const json = JSON.stringify([
			{
				id: 'url-note',
				title: 'example.com',
				body: '[example.com](https://example.com/)',
				folder: '',
				tags: [],
				created: 1,
				modified: 2,
				pinned: 0,
				source: { kind: 'url', title: 'example.com', url: 'https://example.com/' }
			}
		]);
		const result = parseNotesJson(json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.notes[0].source).toEqual({
				kind: 'url',
				title: 'example.com',
				url: 'https://example.com/'
			});
		}
	});
});
