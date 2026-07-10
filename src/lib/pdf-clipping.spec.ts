import { describe, expect, it } from 'vitest';
import { isPdfFile, normalizePdfExcerpt, pdfClippingTitle } from './pdf-clipping';

describe('PDF clipping helpers', () => {
	it('recognizes PDFs by extension or MIME type', () => {
		expect(isPdfFile({ name: 'paper.PDF', type: '' })).toBe(true);
		expect(isPdfFile({ name: 'upload', type: 'application/pdf' })).toBe(true);
		expect(isPdfFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
	});

	it('normalizes selected PDF text into a clean note body and title', () => {
		const text = '  A useful\n\nidea   survives selection. Another sentence follows.';
		expect(normalizePdfExcerpt(text)).toBe(
			'A useful idea survives selection. Another sentence follows.'
		);
		expect(pdfClippingTitle(text)).toBe('A useful idea survives selection');
	});
});
