import { describe, expect, it } from 'vitest';
import {
	detectJsonImportKind,
	externalImportKind,
	splitExternalImportFiles
} from './external-file-drop';

function file(name: string, type = ''): File {
	return new File(['content'], name, { type });
}

describe('external file drops', () => {
	it('recognizes note text, JSON, and unsupported files', () => {
		expect(externalImportKind(file('idea.md'))).toBe('note-text');
		expect(externalImportKind(file('idea.MARKDOWN'))).toBe('note-text');
		expect(externalImportKind(file('scratch.txt', 'text/plain'))).toBe('note-text');
		expect(externalImportKind(file('notes.json'))).toBe('json');
		expect(externalImportKind(file('export', 'application/json'))).toBe('json');
		expect(externalImportKind(file('paper.pdf', 'application/pdf'))).toBe('pdf');
		expect(externalImportKind(file('photo.png', 'image/png'))).toBe('unsupported');
	});

	it('partitions mixed file drops without losing order within a format', () => {
		const a = file('a.md');
		const b = file('b.json');
		const c = file('c.pdf');
		const d = file('d.txt');
		expect(splitExternalImportFiles([a, b, c, d])).toEqual({
			noteTextFiles: [a, d],
			jsonFiles: [b],
			pdfFiles: [c],
			unsupportedFiles: []
		});
	});

	it('distinguishes note exports from sync bundles', () => {
		expect(detectJsonImportKind('[{"id":"one"}]')).toBe('notes');
		expect(detectJsonImportKind('{"version":3,"notes":[],"desk":{}}')).toBe('sync');
		expect(detectJsonImportKind('{"notes":[]}')).toBe('invalid');
		expect(detectJsonImportKind('not json')).toBe('invalid');
	});
});
