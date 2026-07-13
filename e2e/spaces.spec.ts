import { test, expect } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

async function setNoteFolder(page: import('@playwright/test').Page, folder: string) {
	const folderInput = page.locator('.mash-editor-pane input[placeholder="folder"]').first();
	await expect(folderInput).toBeVisible({ timeout: 10_000 });
	await folderInput.fill(folder);
	await folderInput.blur();
	await page.waitForTimeout(400);
}

async function openFolderSpace(page: import('@playwright/test').Page, folder: string) {
	await page.getByRole('button', { name: 'Folders' }).click();
	const peel = page.getByRole('complementary', { name: 'Ingredients' });
	await expect(peel).toBeVisible();
	await peel.getByRole('button', { name: folder, exact: true }).click();
	await expect(page.getByRole('button', { name: 'Open desks' })).toContainText(folder, {
		timeout: 10_000
	});
}

test.describe('Open desks', () => {
	test('open folder boards, switch via overview, close board', async ({ page }) => {
		test.setTimeout(90_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Space Alpha Note', 'Alpha body');
		await page.getByRole('group', { name: 'Space Alpha Note' }).dblclick();
		await setNoteFolder(page, 'SpaceAlpha');
		await page.getByRole('button', { name: 'Collapse to canvas' }).click();

		await createNamedNote(page, 'Space Beta Note', 'Beta body');
		await page.getByRole('group', { name: 'Space Beta Note' }).dblclick();
		await setNoteFolder(page, 'SpaceBeta');
		await page.getByRole('button', { name: 'Collapse to canvas' }).click();

		await openFolderSpace(page, 'SpaceAlpha');
		await expect(page.getByRole('group', { name: 'Space Alpha Note' })).toBeVisible({
			timeout: 10_000
		});

		await openFolderSpace(page, 'SpaceBeta');
		await expect(page.getByRole('group', { name: 'Space Beta Note' })).toBeVisible({
			timeout: 10_000
		});

		await page.getByRole('button', { name: 'Open desks' }).click();
		const dialog = page.getByRole('dialog', { name: 'Open desks' });
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('.mash-spaces-header-mascot')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Switch to Desk' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Switch to SpaceAlpha' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Switch to SpaceBeta' })).toBeVisible();

		await dialog.getByRole('button', { name: 'Switch to SpaceAlpha' }).click();

		await expect(dialog).toBeHidden({ timeout: 5_000 });
		await expect(page.getByRole('button', { name: 'Open desks' })).toContainText('SpaceAlpha', {
			timeout: 10_000
		});
		await expect(page.getByRole('group', { name: 'Space Alpha Note' })).toBeVisible({
			timeout: 10_000
		});

		await page.waitForTimeout(700);
		await page.getByRole('button', { name: 'Open desks' }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close SpaceBeta board' }).click();
		await expect(dialog.getByRole('button', { name: 'Switch to SpaceBeta' })).toHaveCount(0);
		await expect(dialog.getByRole('button', { name: 'Switch to SpaceAlpha' })).toBeVisible();

		await dialog.getByRole('button', { name: 'Close open desks' }).click();
		await expect(dialog).toBeHidden();
	});
});
