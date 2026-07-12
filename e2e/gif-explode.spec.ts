import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wipeIndexedDb } from './helpers';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/two-frame.gif');

test.describe('GIF explode', () => {
	test('opens explode dialog and places frame cards', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const buffer = readFileSync(fixturePath);
		await page.getByTestId('image-sticky-input').setInputFiles({
			name: 'two-frame.gif',
			mimeType: 'image/gif',
			buffer
		});

		const dialog = page.getByTestId('gif-explode-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });
		await expect(dialog.getByText(/\d+ frames/i)).toBeVisible();

		await page.getByTestId('gif-explode-frames').click();

		await expect(page.getByRole('group', { name: /two-frame · f\. 1/i })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByRole('group', { name: /two-frame · f\. 2/i })).toBeVisible();
		await expect(page.getByText(/Exploded \d+ frames/i)).toBeVisible();
	});

	test('one still imports a single card', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const buffer = readFileSync(fixturePath);
		await page.getByTestId('image-sticky-input').setInputFiles({
			name: 'still-pick.gif',
			mimeType: 'image/gif',
			buffer
		});

		await expect(page.getByTestId('gif-explode-dialog')).toBeVisible({ timeout: 15_000 });
		await page.getByTestId('gif-explode-still').click();

		await expect(page.getByRole('group', { name: 'still-pick' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByText(/Added 1 image card/i)).toBeVisible();
	});
});
