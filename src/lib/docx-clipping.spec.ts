import { describe, expect, it } from 'vitest';

import {
	docxClippingTitle,
	docxImageClippingAlt,
	docxImageClippingTitle,
	normalizeDocxExcerpt,
	normalizeDocxImageIndex,
} from './docx-clipping';

describe('docx-clipping', () => {
	it('normalizes whitespace and caps length', () => {
		expect(normalizeDocxExcerpt('  hello   world  ')).toBe('hello world');
		expect(normalizeDocxExcerpt('x'.repeat(20_000)).length).toBe(12_000);
	});

	it('builds a short title from excerpt text', () => {
		expect(docxClippingTitle('First sentence. More.')).toBe('First sentence');
		expect(docxClippingTitle('')).toBe('Word excerpt');
	});

	it('bounds normalizeDocxImageIndex to a minimum of 1', () => {
		expect(normalizeDocxImageIndex(undefined)).toBe(1);
		expect(normalizeDocxImageIndex(NaN)).toBe(1);
		expect(normalizeDocxImageIndex(0)).toBe(1);
		expect(normalizeDocxImageIndex(1.9)).toBe(1);
		expect(normalizeDocxImageIndex(3)).toBe(3);
	});

	it('builds an image title from basename and index', () => {
		expect(docxImageClippingTitle('folder/Report.docx', 2)).toBe('Report · image 2');
		expect(docxImageClippingTitle('C:\\\\docs\\\\Notes.DOCX')).toBe('Notes · image 1');
		expect(docxImageClippingTitle('   ')).toBe('Word document · image 1');
	});

	it('normalizes provided alt text, then falls back to a generated label', () => {
		expect(docxImageClippingAlt('Report.docx', 1, '  Photo [1]  ')).toBe('Photo 1');
		expect(docxImageClippingAlt('folder/Report.docx', 4, '   ')).toBe('Image 4 from Report');
	});
});
