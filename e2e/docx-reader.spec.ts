import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { wipeIndexedDb } from './helpers';

async function minimalDocxBuffer(paragraphText: string): Promise<Buffer> {
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
	return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

test('opens a Word document on the first external drop', async ({ page }) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);

	const buffer = await minimalDocxBuffer('Opened from the first drop');
	const dataTransfer = await page.evaluateHandle((base64) => {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		const transfer = new DataTransfer();
		transfer.items.add(
			new File([bytes], 'first-drop.docx', {
				type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			})
		);
		return transfer;
	}, buffer.toString('base64'));

	const canvas = page.getByRole('application', { name: 'Mash canvas' });
	await canvas.dispatchEvent('dragover', { dataTransfer });
	await canvas.dispatchEvent('drop', { dataTransfer, clientX: 520, clientY: 360 });

	const reader = page.getByRole('region', { name: 'Word document reader' });
	await expect(reader).toBeVisible({ timeout: 15_000 });
	await expect(reader.getByText('Opened from the first drop')).toBeVisible();
	await dataTransfer.dispose();
});

test('opens a Word document and saves a text excerpt', async ({ page }) => {
	await wipeIndexedDb(page);

	await page.getByTestId('docx-reader-input').setInputFiles({
		name: 'reader-session.docx',
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		buffer: await minimalDocxBuffer('Docx excerpt for Mash')
	});

	const reader = page.getByRole('region', { name: 'Word document reader' });
	await expect(reader).toBeVisible();
	await expect(reader.getByText('Docx excerpt for Mash')).toBeVisible();

	const stage = page.getByTestId('docx-reader-stage');
	await stage.evaluate((el) => {
		const selection = window.getSelection();
		const range = document.createRange();
		// Prefer the paragraph text node so selection is non-collapsed and inside the article.
		const textHost = el.querySelector('p') ?? el;
		range.selectNodeContents(textHost);
		selection?.removeAllRanges();
		selection?.addRange(range);
		el
			.closest('.mash-docx-stage')
			?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	});

	await reader.getByRole('button', { name: 'Save excerpt' }).click();
	await expect(reader.getByText('1 saved from this document', { exact: true })).toBeVisible();

	await reader.getByRole('button', { name: 'Open 1 on canvas' }).click();
	await expect(page.getByRole('group', { name: 'Docx excerpt for Mash' })).toBeVisible();
});
