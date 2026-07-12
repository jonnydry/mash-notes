import { expect, test } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test.describe('Quiet desktop board chrome', () => {
	test('keeps primary chips lean and parks secondary under View', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Chrome note', 'On the desk.');

		const top = page.locator('.mash-canvas-chrome-top');
		await expect(top).toBeVisible();

		// Primary row stays lean
		await expect(top.getByRole('button', { name: 'Free' })).toBeVisible();
		await expect(top.getByRole('button', { name: 'Snap' })).toBeVisible();
		await expect(top.getByTestId('board-sequence')).toBeVisible();
		await expect(top.getByRole('button', { name: 'Fit', exact: true })).toBeVisible();
		await expect(top.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
		await expect(top.getByTestId('board-view-toggle')).toBeVisible();

		// Secondary tools are not always-on
		await expect(top.getByRole('button', { name: 'Organize', exact: true })).toHaveCount(0);
		await expect(top.getByRole('button', { name: 'Select all', exact: true })).toHaveCount(0);
		await expect(top.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);

		await top.getByTestId('board-view-toggle').click();
		const menu = page.getByTestId('board-view-menu');
		await expect(menu).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: 'Organize to grid' })).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: 'Select all' })).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: 'Redo layout' })).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: 'Reset pan & zoom' })).toBeVisible();
	});
});
