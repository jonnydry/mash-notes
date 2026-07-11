import { describe, expect, it } from 'vitest';
import {
	isPdfFile,
	normalizePdfExcerpt,
	normalizeRegionRect,
	pdfClippingTitle,
	pdfRegionClippingBody,
	pdfRegionClippingTitle
} from './pdf-clipping';

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

	it('builds region clipping titles and markdown bodies', () => {
		expect(pdfRegionClippingTitle('Scales-and-Modes.pdf', 12)).toBe('Scales-and-Modes · p. 12');
		expect(pdfRegionClippingBody('data:image/png;base64,abc', 'Scales.pdf', 3)).toBe(
			'![PDF clipping from page 3](data:image/png;base64,abc)\n\n_From Scales.pdf, page 3._'
		);
	});

	it('normalizes drag rects into page-bounded positive regions', () => {
		expect(normalizeRegionRect(80, 40, 20, 10, 100, 100)).toEqual({
			x: 20,
			y: 10,
			w: 60,
			h: 30
		});
		expect(normalizeRegionRect(-10, -5, 120, 150, 100, 100)).toEqual({
			x: 0,
			y: 0,
			w: 100,
			h: 100
		});
	});
});
