import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('CSV and TSV import', () => {
	test('previews CSV and places one bounded card per row', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		await page.getByTestId('delimited-import-input').setInputFiles({
			name: 'people.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('Name,Role,Note\nAda,Engineer,"Analytical, precise"\nLinus,Editor,Kind\n')
		});

		const dialog = page.getByTestId('delimited-import-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		await expect(dialog).toContainText('2 rows · 3 columns · CSV');
		await dialog.getByRole('button', { name: /One card per row/ }).click();

		await expect(page.getByTestId('action-status')).toContainText('Imported 2 table rows as cards');
		await expect(page.locator('[data-canvas-card]').filter({ hasText: 'Ada' })).toBeVisible();
		await expect(page.locator('[data-canvas-card]').filter({ hasText: 'Linus' })).toBeVisible();
	});
});
