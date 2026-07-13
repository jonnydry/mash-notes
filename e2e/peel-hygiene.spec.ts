import { expect, test } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test.describe('Peel hygiene', () => {
	test('shows Ingredients tray with desk/kept scope chips', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Desk scrap', 'Temporary.');
		await page.getByRole('group', { name: 'Desk scrap' }).click();
		await page.getByTestId('keep-selection').click();
		await expect(page.getByText(/Kept \d+ card/i)).toBeVisible();
		// Keep may offer browser persistence protection — dismiss if shown.
		const persistDialog = page.getByRole('alertdialog');
		if (await persistDialog.isVisible().catch(() => false)) {
			await persistDialog
				.getByRole('button', { name: /Cancel|Close|Not now/i })
				.click()
				.catch(async () => {
					await page.keyboard.press('Escape');
				});
		}
		await page.keyboard.press('Escape');

		await page
			.getByRole('navigation', { name: 'Mash dock' })
			.getByRole('button', { name: 'Desk', exact: true })
			.click();
		const peel = page.getByRole('complementary', { name: 'Ingredients' });
		await expect(peel).toBeVisible();
		await expect(peel.getByText('Ingredients', { exact: true })).toBeVisible();
		await expect(peel.getByTestId('peel-scope-filter')).toBeVisible();

		// Kept filter should still list the promoted note
		await peel.getByTestId('peel-scope-kept').click();
		await expect(peel.getByRole('option').filter({ hasText: 'Desk scrap' })).toBeVisible();

		// Desk filter excludes kept-only pantry noise when only kept remains as kept-scope
		await peel.getByTestId('peel-scope-desk').click();
		// After keep, the card is scope=kept so it may leave desk filter — that is intentional.
		await peel.getByTestId('peel-scope-ingredients').click();
		await expect(peel.getByRole('option').filter({ hasText: 'Desk scrap' })).toBeVisible();
	});
});
