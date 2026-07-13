import { describe, expect, it } from 'vitest';
import { convertDocxToHtml, docxTitleFromFileName, MAX_DOCX_BYTES } from './docx-import';

/** 1×1 PNG used as an embedded media part in OOXML fixtures. */
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
	const escaped = paragraphText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/** Minimal OOXML package with paragraph text plus an embedded inline PNG. */
async function minimalDocxWithImageBuffer(
	paragraphText: string,
	imageBytes = Buffer.from(TINY_PNG_BASE64, 'base64')
): Promise<ArrayBuffer> {
	const JSZip = (await import('jszip')).default;
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
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
	const escaped = paragraphText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const word = zip.folder('word');
	word?.file(
		'document.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="95250" cy="95250"/>
            <wp:docPr id="1" name="Picture 1"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="0" name="image1.png"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="rIdImage"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="95250" cy="95250"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect"/>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`
	);
	word?.folder('_rels')?.file(
		'document.xml.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`
	);
	word?.folder('media')?.file('image1.png', imageBytes);
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

	it('inlines embedded images in converted HTML', async () => {
		const buffer = await minimalDocxWithImageBuffer('Text beside image');
		const result = await convertDocxToHtml(buffer, 'with-image.docx');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.html).toContain('Text beside image');
			expect(result.html).toMatch(/<img/i);
			expect(result.html).toContain('data:image/png;base64,');
		}
	});

	it('opens an image-only document', async () => {
		const buffer = await minimalDocxWithImageBuffer('');
		const result = await convertDocxToHtml(buffer, 'image-only.docx');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.html).toContain('data:image/png;base64,');
	});

	it('omits embedded raster images whose declared dimensions are unsafe', async () => {
		const oversizedPngHeader = Buffer.alloc(24);
		Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(oversizedPngHeader, 0);
		Buffer.from('IHDR').copy(oversizedPngHeader, 12);
		oversizedPngHeader.writeUInt32BE(20_000, 16);
		oversizedPngHeader.writeUInt32BE(20_000, 20);
		const buffer = await minimalDocxWithImageBuffer('Safe text remains', oversizedPngHeader);
		const result = await convertDocxToHtml(buffer, 'oversized-image.docx');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.html).toContain('Safe text remains');
			expect(result.html).not.toMatch(/<img/i);
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
