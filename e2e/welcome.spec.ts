import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('Mash team welcome', () => {
	test('stays pinned and opens as a read-only illustrated guide', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		await wipeIndexedDb(page);
		const peel = page.getByRole('complementary', { name: 'Ingredients' });
		const row = peel.getByRole('option').filter({ hasText: "Hi — I'm Scoop" });
		await expect(row.locator('img')).toBeVisible();
		await row.dblclick();

		const stage = page.locator('.mash-editor-stage.is-open, .mash-editor-pane').first();
		const title = page.locator('.mash-editor-pane-titlebar input').first();
		await expect(title).toHaveValue("Hi — I'm Scoop");
		await expect(title).toHaveAttribute('readonly', '');
		await expect(stage.getByText('From the Mash team · permanent', { exact: true })).toBeVisible();
		// Stage hero only — canvas/library also show Scoop with the same alt/body preview
		await expect(stage.getByAltText('Scoop, the Mash mascot')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
		await expect(stage.getByText("I'm Scoop. Little potato", { exact: false })).toBeVisible();
		await expect(stage.getByText("I'll be right here", { exact: false })).toBeVisible();
		await expect(
			stage.locator('.mash-sticky-preview strong').filter({ hasText: 'Mash' })
		).toBeVisible();
		await expect(stage.getByPlaceholder('Write here… Use [[Note title]] for links.')).toHaveCount(
			0
		);

		const preview = stage.getByRole('button', { name: 'Preview' });
		await preview.click();
		await expect(stage.locator('.mash-sticky-preview')).toBeVisible();
		await stage.getByRole('button', { name: 'Close pane' }).click();
		await expect(stage).toHaveCount(0);
		await page.getByRole('button', { name: 'New note' }).click();
		await expect(
			page
				.getByRole('application', { name: 'Mash canvas' })
				.getByPlaceholder('Write here… Use [[Note title]] for links.')
		).toBeEditable();
		expect(pageErrors).toEqual([]);
		await expect(page.getByText('Jonathan + Codex')).toHaveCount(0);
	});
});
