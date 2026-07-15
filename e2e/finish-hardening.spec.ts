import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confirmMashDialog, createNamedNote, selectNotesInPeel, wipeIndexedDb } from './helpers';

test.describe('Finish release hardening', () => {
	test('keeps actions reachable on compact desktops and at 200% text size', async ({ page }) => {
		await page.setViewportSize({ width: 1024, height: 768 });
		await wipeIndexedDb(page);
		for (let index = 1; index <= 5; index++) {
			await createNamedNote(
				page,
				`Mobile finish ${index}`,
				`Working material ${index} with enough text to exercise the responsive finish sheet.`
			);
		}

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		const footer = finish.getByTestId('finish-footer');
		const scroll = finish.getByTestId('finish-scroll');
		const dialogBox = await finish.boundingBox();
		expect(dialogBox).not.toBeNull();
		expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
		expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
		expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(1024);
		expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(768);

		const footerY = (await footer.boundingBox())!.y;
		await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
		expect((await footer.boundingBox())!.y).toBeCloseTo(footerY, 0);
		for (const name of ['Back to desk', 'Finish']) {
			expect(
				(await finish.getByRole('button', { name, exact: true }).boundingBox())!.height
			).toBeGreaterThanOrEqual(44);
		}

		await page.evaluate(() => {
			document.documentElement.style.fontSize = '200%';
		});
		await expect(footer).toBeVisible();
		expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
			true
		);
	});

	test('supports a keyboard-only Results download and leave-scratch completion', async ({
		page
	}) => {
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Keyboard source A', 'First source');
		await createNamedNote(page, 'Keyboard source B', 'Second source');
		await selectNotesInPeel(page, ['Keyboard source A', 'Keyboard source B']);
		await page.getByRole('button', { name: 'Mash', exact: true }).click();
		await confirmMashDialog(page);

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		const results = finish.getByRole('radio', { name: /Results · 1/ });
		await results.focus();
		await results.press('Space');
		await expect(results).toBeChecked();

		const downloadButton = finish.getByRole('button', { name: /Download Markdown/ });
		await downloadButton.focus();
		await expect(downloadButton).toBeFocused();
		const downloadPromise = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const download = await downloadPromise;
		const output = path.join(os.tmpdir(), `mash-keyboard-finish-${Date.now()}.md`);
		await download.saveAs(output);
		expect(fs.readFileSync(output, 'utf8')).toContain('Keyboard source A + Keyboard source B');

		const finishButton = finish.getByRole('button', { name: 'Finish', exact: true });
		await finishButton.focus();
		await expect(finishButton).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(finish).toBeHidden();
		await expect(page.getByTestId('action-status')).toContainText('Scratch');
		fs.unlinkSync(output);
	});

	test('allows export retry without losing lifecycle choices', async ({ page }) => {
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Retry takeaway', 'Content survives a clipboard failure.');
		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		await finish.getByRole('checkbox', { name: /Keep this takeaway/ }).check();
		const clear = finish.getByRole('radio', { name: /Clear now/ });
		await clear.focus();
		await clear.press('Space');

		await page.evaluate(() => {
			let attempts = 0;
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: async () => {
						attempts += 1;
						if (attempts === 1) throw new Error('clipboard denied');
					}
				}
			});
		});
		const copy = finish.getByRole('button', { name: /Copy Markdown/ });
		await copy.click();
		await expect(finish.getByRole('status', { name: 'Takeaway export status' })).toContainText(
			'Clipboard unavailable. Download Markdown instead.'
		);
		await expect(finish.getByRole('checkbox', { name: /Keep this takeaway/ })).toBeChecked();
		await expect(clear).toBeChecked();
		await copy.click();
		await expect(finish.getByRole('status', { name: 'Takeaway export status' })).toContainText(
			'Copied 1 card as Markdown'
		);
	});

	test('preserves the Copy escape path when local storage fails', async ({ page }) => {
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Storage fallback', 'Copy this even if keeping fails.');
		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		const keepDesk = finish.getByRole('radio', { name: /Keep entire desk/ });
		await keepDesk.focus();
		await keepDesk.press('Space');
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: async () => undefined }
			});
			IDBObjectStore.prototype.put = function failedPut() {
				throw new DOMException('Storage quota reached', 'QuotaExceededError');
			};
		});

		await finish.getByRole('button', { name: 'Finish', exact: true }).click();
		await expect(finish.getByRole('status', { name: 'Finish lifecycle status' })).toContainText(
			'Mash could not update local storage. Export your work and try again.'
		);
		await expect(keepDesk).toBeChecked();
		await finish.getByRole('button', { name: /Copy Markdown/ }).click();
		await expect(finish.getByRole('status', { name: 'Takeaway export status' })).toContainText(
			'Copied 1 card as Markdown'
		);
		await expect(finish).toBeVisible();
	});

	test('shows explicit focus in forced-colors mode', async ({ page }) => {
		await page.emulateMedia({ forcedColors: 'active' });
		await wipeIndexedDb(page);
		await createNamedNote(page, 'High contrast finish', 'Visible in forced colors.');
		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const choice = page
			.getByRole('dialog', { name: 'Finish this desk' })
			.getByRole('radio', { name: /Whole desk/ });
		await choice.focus();
		await choice.press('Space');
		await expect(choice).toBeChecked();
		const outline = await choice
			.locator('..')
			.evaluate((element) => getComputedStyle(element).outlineStyle);
		expect(outline).toBe('solid');
	});
});
