import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createNamedNote, selectNotesInPeel, wipeIndexedDb } from './helpers';

test.describe('Polished document export', () => {
	test('previews templates and downloads valid PDF and editable Word files', async ({ page }) => {
		test.setTimeout(90_000);
		await page.setViewportSize({ width: 1365, height: 768 });
		await wipeIndexedDb(page);
		await createNamedNote(
			page,
			'Export opening',
			'# Why this matters\n\nA **clear** handoff with room to breathe.\n\n- First point\n- Second point'
		);
		await createNamedNote(
			page,
			'Export ending',
			'> A useful closing thought.\n\n[Reference](https://example.com)'
		);
		await selectNotesInPeel(page, ['Export opening', 'Export ending']);
		await page.getByRole('button', { name: 'Close ingredients' }).click();

		const selectionBar = page.locator('.mash-dock').filter({ hasText: '2 selected' });
		await selectionBar.getByTestId('selection-more-toggle').click();
		await page
			.getByTestId('selection-more-menu')
			.getByRole('button', { name: /Export PDF/ })
			.click();

		const sheet = page.getByRole('dialog', { name: 'Export a polished document' });
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText('Selected · 2 cards');
		const pdfFormat = sheet.getByRole('button', { name: /PDF Ready to send/ });
		const wordFormat = sheet.getByRole('button', { name: /Word Easy to edit/ });
		await expect(pdfFormat).toHaveAttribute('aria-pressed', 'true');
		await expect(wordFormat).toHaveAttribute('aria-pressed', 'false');
		await expect(sheet.getByTestId('export-scroll-cue')).toBeVisible();
		await sheet.getByTestId('export-controls').evaluate((controls) => {
			controls.scrollTop = controls.scrollHeight;
		});
		await expect(sheet.getByTestId('export-scroll-cue')).toBeHidden();
		await expect(sheet.getByRole('radio', { name: /Clean/ })).toBeChecked();
		await sheet.locator('label').filter({ hasText: 'Editorial' }).click();
		await expect(sheet.getByTestId('export-preview')).toHaveClass(/is-editorial/);
		await sheet
			.getByRole('textbox', { name: 'Title', exact: true })
			.fill('A polished project brief');

		const pdfDownloadEvent = page.waitForEvent('download');
		await sheet.getByRole('button', { name: 'Download PDF' }).click();
		const pdfDownload = await pdfDownloadEvent;
		expect(pdfDownload.suggestedFilename()).toBe('a-polished-project-brief.pdf');
		const pdfPath = path.join(os.tmpdir(), `mash-presentation-${Date.now()}.pdf`);
		await pdfDownload.saveAs(pdfPath);
		const pdfBytes = fs.readFileSync(pdfPath);
		expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
		const pdf = await PDFDocument.load(pdfBytes);
		expect(pdf.getTitle()).toBe('A polished project brief');
		expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
		expect(pdfBytes.byteLength).toBeGreaterThan(2_000);

		await wordFormat.click();
		await expect(pdfFormat).toHaveAttribute('aria-pressed', 'false');
		await expect(wordFormat).toHaveAttribute('aria-pressed', 'true');
		await sheet.locator('label').filter({ hasText: 'Sticky deck' }).click();
		await expect(sheet.getByTestId('export-preview')).toHaveClass(/is-sticky-deck/);
		await sheet
			.getByRole('textbox', { name: 'Title', exact: true })
			.fill('An editable project brief');
		const docxDownloadEvent = page.waitForEvent('download');
		await sheet.getByRole('button', { name: 'Download Word document' }).click();
		const docxDownload = await docxDownloadEvent;
		expect(docxDownload.suggestedFilename()).toBe('an-editable-project-brief.docx');
		const docxPath = path.join(os.tmpdir(), `mash-presentation-${Date.now()}.docx`);
		await docxDownload.saveAs(docxPath);
		const docxBytes = fs.readFileSync(docxPath);
		expect([...docxBytes.subarray(0, 2)]).toEqual([80, 75]);
		expect(docxBytes.byteLength).toBeGreaterThan(5_000);

		fs.unlinkSync(pdfPath);
		fs.unlinkSync(docxPath);
	});

	test('opens from Finish with the chosen takeaway scope', async ({ page }) => {
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Finish export one', 'First takeaway.');
		await createNamedNote(page, 'Finish export two', 'Second takeaway.');
		await selectNotesInPeel(page, ['Finish export one', 'Finish export two']);

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		await finish.getByRole('button', { name: /Export Word/ }).click();

		const sheet = page.getByRole('dialog', { name: 'Export a polished document' });
		await expect(sheet).toBeVisible();
		await expect(finish).toBeHidden();
		await expect(sheet).toContainText('Selected · 2 cards');
		await expect(sheet.getByRole('button', { name: /Word Easy to edit/ })).toHaveClass(
			/is-selected/
		);
	});
});
