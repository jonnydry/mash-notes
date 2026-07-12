import { expect, test } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test.describe('Mobile canvas controls', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('keeps secondary controls out of the primary canvas and opens desks from More', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		// Desks entry is under More on mobile (Finish-only header)
		await page.getByRole('button', { name: 'More navigation' }).click();
		await page.locator('.mash-dock-more-menu').getByRole('button', { name: 'Desks' }).click();
		const closeTarget = await page
			.getByRole('dialog', { name: 'Your desks' })
			.getByRole('button', { name: 'Close desk panel' })
			.boundingBox();
		expect(closeTarget?.width).toBeGreaterThanOrEqual(44);
		expect(closeTarget?.height).toBeGreaterThanOrEqual(44);
		await page
			.getByRole('dialog', { name: 'Your desks' })
			.getByRole('button', { name: 'Close desk panel' })
			.click();

		const dismiss = page.getByTestId('try-a-mash-dismiss');
		if (await dismiss.isVisible().catch(() => false)) {
			await dismiss.click();
		}
		await createNamedNote(page, 'Mobile alpha', 'Stay on this desk');
		await expect(page.getByRole('group', { name: /Mobile alpha/ })).toBeVisible({
			timeout: 10_000
		});

		await expect(page.locator('.mash-canvas-chrome-mobile')).toBeVisible();
		await expect(page.locator('.mash-canvas-chrome-top')).toBeHidden();
		await expect(page.locator('.mash-canvas-chrome-pan')).toBeHidden();
		await expect(page.getByRole('button', { name: 'More navigation' })).toBeVisible();

		await page.getByRole('button', { name: 'More canvas tools' }).click();
		await expect(page.getByRole('button', { name: 'Free placement' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
		await page.getByRole('button', { name: 'More canvas tools' }).click();

		await page.getByRole('button', { name: 'More navigation' }).click();
		const moreMenu = page.locator('.mash-dock-more-menu');
		await expect(moreMenu.getByRole('button', { name: 'Settings' })).toBeVisible();
		await expect(moreMenu.getByRole('button', { name: 'Folders' })).toBeVisible();
		await expect(moreMenu.getByRole('button', { name: 'Desks' })).toBeVisible();
	});
});
