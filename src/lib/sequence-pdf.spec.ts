import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildSequencePdf, noteBodyForPdf } from './sequence-pdf';
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

describe('noteBodyForPdf', () => {
	it('strips light markdown and expands wikilinks', () => {
		expect(noteBodyForPdf('**Bold** and [[Target|Label]]')).toContain('Bold');
		expect(noteBodyForPdf('**Bold** and [[Target|Label]]')).toContain('Label');
		expect(noteBodyForPdf('- item')).toContain('- item');
	});

	it('sanitizes emoji and CJK so Helvetica can encode them', () => {
		expect(noteBodyForPdf('Hello 😀 world')).toBe('Hello ? world');
		expect(noteBodyForPdf('中文')).toBe('??');
	});
});

describe('buildSequencePdf', () => {
	it('gives each short note its own page', async () => {
		const bytes = await buildSequencePdf([
			note({ id: '1', title: 'Project ideas', body: '- Build' }),
			note({ id: '2', title: 'Goals', body: '1. Fast' })
		]);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(2);
	});

	it('still emits a page for an empty body', async () => {
		const bytes = await buildSequencePdf([note({ id: '1', title: 'Blank', body: '' })]);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(1);
	});

	it('continues a long note onto following pages', async () => {
		const longBody = Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a long note.`).join(
			'\n'
		);
		const bytes = await buildSequencePdf([
			note({ id: '1', title: 'Long', body: longBody }),
			note({ id: '2', title: 'Short', body: 'Done.' })
		]);
		const doc = await PDFDocument.load(bytes);
		// Long note spills past one page; short note still starts on a fresh page after.
		expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
	});

	it('does not throw on emoji or CJK in title/body', async () => {
		const bytes = await buildSequencePdf([
			note({ id: '1', title: 'Hello 😀', body: '中文 and café' })
		]);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(1);
	});

	it('returns a single placeholder page for an empty sequence', async () => {
		const bytes = await buildSequencePdf([]);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(1);
	});
});
