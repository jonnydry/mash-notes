import { expect, test } from '@playwright/test';
import { confirmMashDialog, wipeIndexedDb } from './helpers';

async function openFreshEmptyDesk(page: import('@playwright/test').Page) {
	await wipeIndexedDb(page);
	await page.evaluate(() => localStorage.removeItem('mash.tryAMashDismissed'));
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	// Close peel so empty-state CTA is free
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('try-a-mash')).toBeVisible({ timeout: 15_000 });
}

test.describe('Try a mash teaching', () => {
	test('empty desk offers a one-shot demo that lands two cards ready to mash', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await openFreshEmptyDesk(page);

		await page.getByTestId('try-a-mash').click();

		await expect(page.getByRole('group', { name: /Half-baked idea/ })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('group', { name: /Another scrap/ })).toBeVisible();
		await expect(page.getByTestId('action-status')).toContainText(/Both selected|Mash/i);
		await expect(page.getByTestId('try-a-mash')).toBeHidden();

		await expect(page.getByTestId('selection-mash')).toBeVisible();
		await page.getByTestId('selection-mash').click();
		await confirmMashDialog(page);
		await expect(
			page.getByRole('group', { name: /Half-baked idea \+ Another scrap/ })
		).toBeVisible({ timeout: 10_000 });
	});

	test('Not now dismisses forever', async ({ page }) => {
		test.setTimeout(60_000);
		await openFreshEmptyDesk(page);

		await page.getByTestId('try-a-mash-dismiss').click();
		await expect(page.getByTestId('try-a-mash')).toBeHidden();
		await expect
			.poll(async () => page.evaluate(() => localStorage.getItem('mash.tryAMashDismissed')))
			.toBe('1');

		await page.reload();
		await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
			timeout: 30_000
		});
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('try-a-mash')).toBeHidden();
	});
});
