import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildExportDocument } from './export-document';
import { defaultPresentationExportOptions } from './export-templates';
import { buildPresentationDocx } from './presentation-docx';
import type { Note } from './types';

function note(title: string, body: string): Note {
	return {
		id: title,
		title,
		body,
		folder: 'Research',
		tags: ['brief'],
		created: 1,
		modified: 1,
		pinned: 0
	};
}

describe('presentation DOCX', () => {
	it('packages editable styles, headings, lists, links, page fields, and metadata', async () => {
		const document = buildExportDocument(
			[
				note('Opening', '# Point\n\n- First\n- Second\n\n[Source](https://example.com)'),
				note('Closing', 'Done.')
			],
			{ title: 'Editable brief', sourceLabel: 'Selected · 2 cards', createdAt: 1 }
		);
		const options = defaultPresentationExportOptions('docx', document.title, 2);
		const blob = await buildPresentationDocx(document, options);
		const zip = await JSZip.loadAsync(await blob.arrayBuffer());
		const documentXml = await zip.file('word/document.xml')!.async('string');
		const stylesXml = await zip.file('word/styles.xml')!.async('string');
		const footerXml = await zip.file('word/footer1.xml')!.async('string');

		expect(documentXml).toContain('Editable brief');
		expect(documentXml).toContain('Opening');
		expect(documentXml).toContain('w:numPr');
		expect(documentXml).toContain('w:hyperlink');
		expect(stylesXml).toContain('Mash Note Title');
		expect(stylesXml).toContain('Mash Body');
		expect(footerXml).toContain('NUMPAGES');
		expect(blob.size).toBeGreaterThan(5_000);
	});

	it('uses real page breaks for Sticky deck notes', async () => {
		const document = buildExportDocument([note('One', 'First'), note('Two', 'Second')], {
			title: 'Deck',
			sourceLabel: 'Sequence 1 · 2 pages'
		});
		const options = {
			...defaultPresentationExportOptions('docx', document.title, 2),
			templateId: 'sticky-deck' as const,
			includeCover: false
		};
		const zip = await JSZip.loadAsync(
			await (await buildPresentationDocx(document, options)).arrayBuffer()
		);
		const xml = await zip.file('word/document.xml')!.async('string');
		expect(xml).toContain('w:type="page"');
	});
});
