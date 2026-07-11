import { describe, expect, it } from 'vitest';
import { convertDocxToHtml, docxTitleFromFileName, MAX_DOCX_BYTES } from './docx-import';

/** Minimal OOXML package with one paragraph (zip of [Content_Types] + word/document.xml). */
async function minimalDocxBuffer(paragraphText: string): Promise<ArrayBuffer> {
	const JSZip = (await import('jszip')).default;
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	);
	zip.folder('_rels')?.file(
		'.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
	);
	const escaped = paragraphText
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	zip.folder('word')?.file(
		'document.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`
	);
	const bytes = await zip.generateAsync({ type: 'arraybuffer' });
	return bytes;
}

describe('docx-import', () => {
	it('derives a title from the filename', () => {
		expect(docxTitleFromFileName('Brief Notes.DOCX')).toBe('Brief Notes');
		expect(docxTitleFromFileName('  ')).toBe('Untitled document');
	});

	it('converts a minimal docx to HTML containing the paragraph text', async () => {
		const buffer = await minimalDocxBuffer('Hello from Word');
		const result = await convertDocxToHtml(buffer, 'hello.docx');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.title).toBe('hello');
			expect(result.html).toContain('Hello from Word');
		}
	});

	it('rejects oversized files', async () => {
		const huge = new ArrayBuffer(MAX_DOCX_BYTES + 1);
		const result = await convertDocxToHtml(huge, 'big.docx');
		expect(result).toEqual({
			ok: false,
			error: 'This Word document is too large to open (max 8MB).'
		});
	});

	it('rejects empty / unreadable conversion output', async () => {
		const buffer = await minimalDocxBuffer('');
		const result = await convertDocxToHtml(buffer, 'empty.docx');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/No readable text/i);
		}
	});

	it('rejects corrupt bytes', async () => {
		const corrupt = new TextEncoder().encode('not a zip').buffer;
		const result = await convertDocxToHtml(corrupt, 'bad.docx');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/Couldn.?t open this Word document/i);
		}
	});
});
