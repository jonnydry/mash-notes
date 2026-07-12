import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('Mash team welcome', () => {
	test('stays pinned and opens as a read-only illustrated guide', async ({ page }) => {
		await wipeIndexedDb(page);
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		const row = peel.getByRole('option').filter({ hasText: "Hi — I'm Scoop" });
		await expect(row.locator('img')).toBeVisible();
		await row.dblclick();

		const title = page.locator('.mash-editor-pane-titlebar input').first();
		await expect(title).toHaveValue("Hi — I'm Scoop");
		await expect(title).toHaveAttribute('readonly', '');
		await expect(page.getByText('From the Mash team · permanent', { exact: true })).toBeVisible();
		await expect(page.getByAltText('Scoop, the Mash mascot')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
		await expect(page.getByText("I'm Scoop. Little potato", { exact: false })).toBeVisible();
		await expect(page.getByText("I'll be right here", { exact: false })).toBeVisible();
		await expect(page.getByText('Jonathan + Codex')).toHaveCount(0);
	});
});
