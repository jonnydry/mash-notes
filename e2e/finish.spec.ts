import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNamedNote, openDesksPanel, selectNotesInPeel, wipeIndexedDb } from './helpers';

test.describe('Consolidated Finish takeaway', () => {
	test('keeps a selected takeaway while clearing the remaining scratch desk', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Durable takeaway', 'Keep this conclusion.');
		await createNamedNote(page, 'Disposable ingredient', 'Clear this working material.');
		await selectNotesInPeel(page, ['Durable takeaway']);

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		await expect(finish.getByRole('radio', { name: 'Selected · 1' })).toBeChecked();
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: async () => undefined }
			});
		});
		await finish.getByRole('button', { name: /Copy Markdown/ }).click();
		await expect(finish.getByRole('status')).toContainText('Copied 1 card as Markdown');
		await finish.getByRole('checkbox', { name: /Keep this takeaway/ }).check();
		const clearNow = finish.getByRole('radio', { name: /Clear now/ });
		await clearNow.focus();
		await clearNow.press('Space');
		await finish.getByRole('button', { name: 'Finish and clear' }).click();

		const confirm = page.getByRole('alertdialog', { name: 'Clear this desk?' });
		await expect(confirm).toContainText('Keep 1 takeaway card on this device');
		await confirm.getByRole('button', { name: 'Keep takeaway and clear' }).click();
		await expect(page.getByTestId('action-status')).toContainText('Kept 1 card');

		await openDesksPanel(page);
		const desks = page.getByRole('dialog', { name: 'Your desks' });
		await expect(desks.getByText('Recently cleared')).toBeVisible();
		await desks.getByRole('button').filter({ hasText: 'Kept takeaways' }).click();
		await expect(desks).toBeHidden();
		await page.locator('[data-dock-item="all"]').click();
		const ingredients = page.getByRole('complementary', { name: 'Ingredients' });
		await expect(
			ingredients.getByRole('option').filter({ hasText: 'Durable takeaway' })
		).toBeVisible();
		await expect(
			ingredients.getByRole('option').filter({ hasText: 'Disposable ingredient' })
		).toBeHidden();
	});

	test('exports the selected scope and labels the whole-desk bundle honestly', async ({ page }) => {
		test.setTimeout(90_000);
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Finish Alpha', 'Alpha takeaway');
		await createNamedNote(page, 'Finish Beta', 'Beta takeaway');
		await selectNotesInPeel(page, ['Finish Alpha', 'Finish Beta']);

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		await expect(finish.getByRole('radio', { name: 'Selected · 2' })).toBeChecked();
		await expect(finish).toContainText('Finish Alpha, Finish Beta');

		const markdownDownload = page.waitForEvent('download');
		await finish.getByRole('button', { name: /Download Markdown/ }).click();
		const markdown = await markdownDownload;
		const markdownPath = path.join(os.tmpdir(), `mash-finish-${Date.now()}.md`);
		await markdown.saveAs(markdownPath);
		const markdownText = fs.readFileSync(markdownPath, 'utf8');
		expect(markdownText.indexOf('# Finish Alpha')).toBeLessThan(
			markdownText.indexOf('# Finish Beta')
		);
		await expect(finish.getByRole('status')).toContainText('Downloaded 2 cards as Markdown');

		const boardDownload = page.waitForEvent('download');
		await finish.getByRole('button', { name: /Board image/ }).click();
		const boardImage = await boardDownload;
		expect(boardImage.suggestedFilename()).toMatch(/selected-board\.png$/);
		const boardImagePath = path.join(os.tmpdir(), `mash-finish-board-${Date.now()}.png`);
		await boardImage.saveAs(boardImagePath);
		const boardPng = fs.readFileSync(boardImagePath);
		expect([...boardPng.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(boardPng.readUInt32BE(16)).toBeGreaterThan(0);
		expect(boardPng.readUInt32BE(16)).toBeLessThanOrEqual(4096);
		expect(boardPng.readUInt32BE(20)).toBeGreaterThan(0);
		expect(boardPng.readUInt32BE(20)).toBeLessThanOrEqual(4096);
		await expect(finish.getByRole('status')).toContainText('Downloaded 2 cards as a');

		const wholeDeskScope = finish.getByRole('radio', { name: /Whole desk/ });
		await wholeDeskScope.focus();
		await wholeDeskScope.press('Space');
		await expect(wholeDeskScope).toBeChecked();
		await page.evaluate(() => {
			const state = window as typeof window & { __mashPrintOpened?: boolean };
			window.open = (() => {
				state.__mashPrintOpened = true;
				return { opener: null } as Window;
			}) as typeof window.open;
		});
		await finish.getByRole('button', { name: /Print \/ save PDF/ }).click();
		await expect
			.poll(() =>
				page.evaluate(() =>
					Boolean((window as typeof window & { __mashPrintOpened?: boolean }).__mashPrintOpened)
				)
			)
			.toBe(true);
		await expect(finish.getByRole('status')).toContainText('for printing or PDF');

		const bundleDownload = page.waitForEvent('download');
		await finish.getByRole('button', { name: /Desk bundle/ }).click();
		const bundle = await bundleDownload;
		const bundlePath = path.join(os.tmpdir(), `mash-finish-${Date.now()}.json`);
		await bundle.saveAs(bundlePath);
		const bundleJson = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
		expect(bundleJson.version).toBe(6);
		expect(bundleJson.notes.map((note: { title: string }) => note.title)).toEqual(
			expect.arrayContaining(['Finish Alpha', 'Finish Beta'])
		);
		await expect(finish.getByRole('status')).toContainText('whole desk');
		const keepDesk = finish.getByRole('radio', { name: /Keep entire desk/ });
		await keepDesk.focus();
		await keepDesk.press('Space');
		await finish.getByRole('button', { name: 'Finish', exact: true }).click();
		// Persistence prompt can appear after Keep — dismiss before reopening Finish/desks
		const protectionPrompt = page.getByRole('alertdialog', { name: 'Help protect kept desks?' });
		try {
			await protectionPrompt.waitFor({ state: 'visible', timeout: 4_000 });
			await protectionPrompt.getByRole('button', { name: 'Cancel' }).click();
			await expect(protectionPrompt).toBeHidden();
		} catch {
			/* no prompt */
		}
		await openDesksPanel(page);
		await expect(
			page.getByRole('dialog', { name: 'Your desks' }).getByText('Kept on this device')
		).toBeVisible();
		await page
			.getByRole('dialog', { name: 'Your desks' })
			.getByRole('button', { name: 'Close desk panel' })
			.click();

		fs.unlinkSync(markdownPath);
		fs.unlinkSync(boardImagePath);
		fs.unlinkSync(bundlePath);
	});
});
