import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { buildExportDocument, type ExportTemplateId } from './export-document';
import { defaultPresentationExportOptions } from './export-templates';
import { buildPresentationPdf, type PresentationPdfFontBytes } from './presentation-pdf';
import type { Note } from './types';

function note(title: string, body: string): Note {
	return {
		id: title,
		title,
		body,
		folder: 'Projects',
		tags: ['export'],
		created: 1,
		modified: 1,
		pinned: 0
	};
}

function productionFonts(templateId: ExportTemplateId): PresentationPdfFontBytes | undefined {
	if (templateId === 'editorial') return undefined;
	const load = (weight: 400 | 700) =>
		Uint8Array.from(
			readFileSync(
				`node_modules/pdfjs-dist/standard_fonts/LiberationSans-${weight === 400 ? 'Regular' : 'Bold'}.ttf`
			)
		).buffer;
	return { regular: load(400), bold: load(700) };
}

describe('presentation PDF', () => {
	it.each(['clean', 'editorial', 'sticky-deck'] as const)(
		'builds the %s template with metadata and pagination',
		async (templateId) => {
			const document = buildExportDocument(
				[
					note('Opening', '# Heading\n\nA polished paragraph with **structure**.'),
					note('Next', '- First\n- Second')
				],
				{ title: 'Project brief', sourceLabel: 'Selected · 2 cards', createdAt: 1 }
			);
			const options = {
				...defaultPresentationExportOptions('pdf', document.title, document.sections.length),
				templateId
			};
			const bytes = await buildPresentationPdf(document, options, productionFonts(templateId));
			const qaDirectory = process.env.MASH_EXPORT_QA_DIR?.trim();
			if (qaDirectory) {
				mkdirSync(qaDirectory, { recursive: true });
				writeFileSync(path.join(qaDirectory, `${templateId}.pdf`), bytes);
			}
			const pdf = await PDFDocument.load(bytes);
			expect(pdf.getTitle()).toBe('Project brief');
			expect(pdf.getPageCount()).toBeGreaterThanOrEqual(templateId === 'sticky-deck' ? 3 : 2);
			expect(bytes.byteLength).toBeGreaterThan(1_000);
		}
	);

	it('continues a long note without clipping the following section', async () => {
		const longBody = Array.from(
			{ length: 180 },
			(_, index) => `Line ${index + 1} keeps going.`
		).join('\n');
		const document = buildExportDocument([note('Long note', longBody), note('Ending', 'Done.')], {
			title: 'Long export',
			sourceLabel: 'Whole desk · 2 cards'
		});
		const bytes = await buildPresentationPdf(
			document,
			defaultPresentationExportOptions('pdf', document.title, 2)
		);
		const pdf = await PDFDocument.load(bytes);
		expect(pdf.getPageCount()).toBeGreaterThan(2);
	});
});
