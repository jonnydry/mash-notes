import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	FILE_ACCEPT,
	FILE_FORMATS,
	FILE_FORMAT_LIMITS,
	acceptFor,
	fileMatchesFormat
} from './file-formats';

describe('file format contract', () => {
	it('keeps one entry per format id', () => {
		const ids = FILE_FORMATS.map((format) => format.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('builds deduplicated picker accept strings', () => {
		expect(acceptFor(['notes-json', 'mash-bundle'])).toBe('.json,application/json');
	});

	it('matches supported extensions case-insensitively and MIME hints', () => {
		expect(fileMatchesFormat({ name: 'NOTES.MD', type: '' }, 'markdown')).toBe(true);
		expect(fileMatchesFormat({ name: 'upload', type: 'application/pdf' }, 'pdf')).toBe(true);
		expect(fileMatchesFormat({ name: 'table.tsv', type: 'text/plain' }, 'tsv')).toBe(true);
		expect(fileMatchesFormat({ name: 'archive.zip', type: 'application/zip' }, 'docx')).toBe(false);
	});

	it('exposes aligned top-level limits and pickers', () => {
		expect(FILE_FORMAT_LIMITS.pdfBytes).toBe(50 * 1024 * 1024);
		expect(FILE_FORMAT_LIMITS.delimitedBytes).toBe(2 * 1024 * 1024);
		expect(FILE_ACCEPT.images).toContain('image/png');
		expect(FILE_ACCEPT.delimited).toContain('.csv');
		expect(FILE_ACCEPT.json).toBe(acceptFor(['notes-json', 'mash-bundle', 'workspace-backup']));
		expect(FILE_ACCEPT.pdf).toBe(acceptFor(['pdf']));
		expect(FILE_ACCEPT.docx).toBe(acceptFor(['docx']));
		expect(FILE_ACCEPT.html).toBe(acceptFor(['html']));
		expect(FILE_ACCEPT.images).toBe(acceptFor(['png', 'jpeg', 'webp', 'gif']));
		expect(FILE_ACCEPT.markdownVault).toBe(acceptFor(['markdown']));
		expect(FILE_ACCEPT.delimited).toBe(acceptFor(['csv', 'tsv']));
	});

	it('documents every registered format in the public compatibility matrix', () => {
		const documentation = readFileSync(
			new URL('../../docs/file-formats.md', import.meta.url),
			'utf8'
		);
		for (const format of FILE_FORMATS) {
			expect(documentation).toContain(`| \`${format.id}\``);
		}
	});
});
