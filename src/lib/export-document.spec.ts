import { describe, expect, it } from 'vitest';
import { buildExportDocument, exportDocumentWordCount, noteSourceLabel } from './export-document';
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

describe('export document', () => {
	it('normalizes ordered notes without exposing internal ids', () => {
		const document = buildExportDocument(
			[
				note({
					id: 'private-id',
					title: 'Opening',
					body: '# Point\n\nUse **Mash** with [[Ideas]].',
					folder: 'Work',
					tags: ['brief'],
					source: { kind: 'pdf', title: 'Source.pdf', page: 4 }
				}),
				note({ id: 'second-id', title: 'Closing', body: '- Done' })
			],
			{ title: 'Project brief', sourceLabel: 'Sequence 1 · 2 pages', createdAt: 10 }
		);

		expect(document.sections.map((section) => section.title)).toEqual(['Opening', 'Closing']);
		expect(document.sections[0]).toMatchObject({
			position: 1,
			folder: 'Work',
			tags: ['brief'],
			sourceLabel: 'Source.pdf · page 4'
		});
		expect(JSON.stringify(document)).not.toContain('private-id');
		expect(exportDocumentWordCount(document)).toBeGreaterThan(4);
	});

	it('writes readable labels for captured sources', () => {
		expect(noteSourceLabel({ kind: 'table', title: 'Data.csv', format: 'csv', row: 3 })).toBe(
			'Data.csv · row 3'
		);
		expect(noteSourceLabel(undefined)).toBe('');
	});
});
