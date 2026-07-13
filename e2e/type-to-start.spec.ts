import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test('typing on the desk starts in the note body while New note starts in the title', async ({
	page
}) => {
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
	await page.getByRole('button', { name: 'New note' }).click();
	const title = page.locator('[data-canvas-card] input[type="text"]').first();
	await expect(title).toBeFocused();
	await page.keyboard.type('Named note');
	await expect(title).toHaveValue('Named note');
});
