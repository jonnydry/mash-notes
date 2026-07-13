import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test('typing on the desk and New note both start in the note body', async ({ page }) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);
	await page.keyboard.press('Escape');

	await page.keyboard.press('H');
	const body = page.getByPlaceholder('Write here… Use [[Note title]] for links.');
	await expect(body).toBeFocused({ timeout: 10_000 });
	await page.keyboard.type('ello');
	await expect(body).toHaveValue('Hello');
	await expect(page.locator('[data-canvas-card] input[type="text"]').first()).toHaveValue(
		'Untitled'
	);

	await page.getByRole('button', { name: 'Collapse sticky' }).click();
	for (let i = 0; i < 6; i++) {
		await page.getByRole('button', { name: 'Zoom in' }).click();
	}
	await page.getByRole('button', { name: 'New note' }).click();
	const title = page.locator('[data-canvas-card] input[type="text"]').first();
	await expect(body).toBeFocused();
	await page.keyboard.type('New note body');
	await expect(body).toHaveValue('New note body');
	await expect(title).toHaveValue('Untitled');
	await page.getByRole('button', { name: 'View board tools' }).click();
	await expect(page.getByText('100%', { exact: true })).toBeVisible();
});
