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
	it('recognizes note text, JSON, documents, images, tables, and unsupported files', () => {
		expect(externalImportKind(file('idea.md'))).toBe('note-text');
		expect(externalImportKind(file('idea.MARKDOWN'))).toBe('note-text');
		expect(externalImportKind(file('scratch.txt', 'text/plain'))).toBe('note-text');
		expect(externalImportKind(file('notes.json'))).toBe('json');
		expect(externalImportKind(file('export', 'application/json'))).toBe('json');
		expect(externalImportKind(file('paper.pdf', 'application/pdf'))).toBe('pdf');
		expect(externalImportKind(file('brief.docx'))).toBe('docx');
		expect(externalImportKind(file('Brief.DOCX'))).toBe('docx');
		expect(
			externalImportKind(
				file('memo', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
			)
		).toBe('docx');
		expect(externalImportKind(file('page.html'))).toBe('html');
		expect(externalImportKind(file('page.HTM'))).toBe('html');
		expect(externalImportKind(file('x', 'text/html'))).toBe('html');
		expect(externalImportKind(file('photo.png', 'image/png'))).toBe('image');
		expect(externalImportKind(file('shot.JPEG'))).toBe('image');
		expect(externalImportKind(file('clip.webp', 'image/webp'))).toBe('image');
		expect(externalImportKind(file('anim.gif'))).toBe('image');
		expect(externalImportKind(file('pic', 'image/jpeg'))).toBe('image');
		expect(externalImportKind(file('ideas.csv', 'text/csv'))).toBe('delimited');
		expect(externalImportKind(file('ideas.TSV'))).toBe('delimited');
		expect(externalImportKind(file('essay.pages'))).toBe('unsupported');
		expect(externalImportKind(file('vector.svg', 'image/svg+xml'))).toBe('unsupported');
	});

	it('partitions mixed file drops without losing order within a format', () => {
		const a = file('a.md');
		const b = file('b.json');
		const c = file('c.pdf');
		const d = file('d.txt');
		const e = file('e.docx');
		const f = file('f.png', 'image/png');
		const g = file('g.html');
		const h = file('h.csv');
		expect(splitExternalImportFiles([a, b, c, d, e, f, g, h])).toEqual({
			noteTextFiles: [a, d],
			jsonFiles: [b],
			pdfFiles: [c],
			docxFiles: [e],
			htmlFiles: [g],
			imageFiles: [f],
			delimitedFiles: [h],
			unsupportedFiles: []
		});
	});

	it('distinguishes note exports from sync bundles', () => {
		expect(detectJsonImportKind('[{"id":"one"}]')).toBe('notes');
		expect(detectJsonImportKind('{"version":3,"notes":[],"desk":{}}')).toBe('sync');
		expect(
			detectJsonImportKind('{"kind":"mash-backup","scope":"workspace","version":6,"notes":[]}')
		).toBe('workspace-backup');
		expect(detectJsonImportKind('{"notes":[]}')).toBe('invalid');
		expect(detectJsonImportKind('not json')).toBe('invalid');
	});
});
