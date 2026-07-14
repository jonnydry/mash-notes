import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { wipeIndexedDb } from './helpers';

async function readerPdfBuffer(): Promise<Buffer> {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	for (const [index, text] of ['First page excerpt', 'Second page excerpt'].entries()) {
		const page = pdf.addPage([612, 792]);
		page.drawText(text, { x: 72, y: 700, size: 18, font });
		page.drawText(`Supporting text for page ${index + 1}.`, {
			x: 72,
			y: 660,
			size: 13,
			font
		});
	}
	return Buffer.from(await pdf.save());
}

test('returns to a live PDF session without rereading the file', async ({ page }) => {
	await page.addInitScript(() => {
		const original = File.prototype.arrayBuffer;
		Object.defineProperty(File.prototype, 'arrayBuffer', {
			configurable: true,
			value: function trackedArrayBuffer(this: File) {
				const trackedWindow = window as typeof window & {
					__mashPdfArrayBufferReads?: number;
				};
				trackedWindow.__mashPdfArrayBufferReads =
					(trackedWindow.__mashPdfArrayBufferReads ?? 0) + 1;
				return original.call(this);
			}
		});
	});
	await wipeIndexedDb(page);

	await page.getByTestId('pdf-reader-input').setInputFiles({
		name: 'reader-session.pdf',
		mimeType: 'application/pdf',
		buffer: await readerPdfBuffer()
	});

	const reader = page.getByRole('region', { name: 'PDF reader' });
	await expect(reader).toBeVisible();
	await expect(reader.getByText('First page excerpt', { exact: true })).toBeVisible();
	await reader.getByRole('button', { name: 'Next page' }).click();
	const selectedSpan = page.locator('.textLayer span').filter({ hasText: 'Second page excerpt' });
	await expect(selectedSpan).toBeVisible();
	const pdfCanvas = reader.getByLabel('PDF page 2', { exact: true });
	const widthBeforeZoom = await pdfCanvas.evaluate(
		(canvas) => canvas.getBoundingClientRect().width
	);
	await reader.getByRole('button', { name: 'Zoom in' }).click();
	await expect(reader.getByText('Second page excerpt', { exact: true })).toBeVisible();
	await expect(reader.getByText('110%', { exact: true })).toBeVisible();
	await expect
		.poll(() => pdfCanvas.evaluate((canvas) => canvas.getBoundingClientRect().width))
		.toBeGreaterThan(widthBeforeZoom * 1.05);
	// Zoom updates canvas geometry before PDF.js replaces the selectable text layer.
	// Wait for the full render so the range below cannot be invalidated mid-selection.
	await expect(reader.getByText('Rendering page…', { exact: true })).toBeHidden();
	await expect(selectedSpan).toBeVisible();

	const selectedText = await selectedSpan.evaluate((span) => {
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(span);
		selection?.removeAllRanges();
		selection?.addRange(range);
		return selection?.toString() ?? '';
	});
	expect(selectedText).toContain('Second page excerpt');
	await reader
		.getByRole('region', { name: 'PDF page viewport' })
		.dispatchEvent('pointerup', { bubbles: true });
	await reader.getByRole('button', { name: 'Save excerpt' }).click();
	await expect(reader.getByText('1 saved from this PDF', { exact: true })).toBeVisible();

	await reader.getByRole('button', { name: 'Open 1 on canvas' }).click();
	await expect(page.getByRole('group', { name: 'Second page excerpt' })).toBeVisible();
	const returnToPdf = page.locator('.mash-reader-return');
	await expect(returnToPdf).toContainText('reader-session.pdf');
	await returnToPdf.click();

	await expect(reader).toBeVisible();
	await expect(
		reader.getByLabel('Selectable PDF text').getByText('Second page excerpt', { exact: true })
	).toBeVisible();
	await expect(reader.getByText('110%', { exact: true })).toBeVisible();
	await expect(reader.getByText('1 saved from this PDF', { exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as typeof window & { __mashPdfArrayBufferReads?: number })
						.__mashPdfArrayBufferReads ?? 0
			)
		)
		.toBe(1);
});
