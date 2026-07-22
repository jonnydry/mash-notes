import type { ExportDocument, PresentationExportOptions } from './export-document';

function slugify(value: string, fallback: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || fallback
	);
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function exportPresentationDocument(
	document: ExportDocument,
	options: PresentationExportOptions
): Promise<{ filename: string }> {
	const stem = slugify(options.documentTitle, 'mash-export');
	if (options.format === 'pdf') {
		const { buildPresentationPdf, loadPresentationPdfFonts } = await import('./presentation-pdf');
		const fonts = await loadPresentationPdfFonts(options.templateId);
		const bytes = await buildPresentationPdf(document, options, fonts);
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		const filename = `${stem}.pdf`;
		downloadBlob(new Blob([copy], { type: 'application/pdf' }), filename);
		return { filename };
	}

	const { buildPresentationDocx } = await import('./presentation-docx');
	const blob = await buildPresentationDocx(document, options);
	const filename = `${stem}.docx`;
	downloadBlob(blob, filename);
	return { filename };
}
