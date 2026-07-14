import { test, expect } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test.describe('Workspace backup', () => {
	test('downloads a verified backup, previews it, and restores its cards', async ({ page }) => {
		test.setTimeout(90_000);
		await wipeIndexedDb(page);
		await createNamedNote(page, 'Backup round trip', 'This card survives a fresh local workspace.');

		await page.getByRole('button', { name: 'Settings' }).click();
		const downloadPromise = page.waitForEvent('download');
		await page.getByTestId('backup-workspace').click();
		await expect(page.getByTestId('action-status')).toContainText('Workspace backup created', {
			timeout: 15_000
		});
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('mash-workspace-backup.json');
		const backupPath = await download.path();
		expect(backupPath).toBeTruthy();

		await wipeIndexedDb(page);
		await page.getByTestId('workspace-restore-input').setInputFiles(backupPath!);
		const dialog = page.getByTestId('workspace-restore-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });
		await expect(dialog.getByTestId('workspace-restore-impact')).toContainText('added');
		await dialog.getByRole('button', { name: 'Restore backup' }).click();
		await expect(page.getByTestId('action-status')).toContainText('Restored workspace', {
			timeout: 20_000
		});

		await page.getByRole('button', { name: 'Desk', exact: true }).click();
		const peel = page.getByRole('complementary', { name: 'Ingredients' });
		await expect(peel.getByRole('option').filter({ hasText: 'Backup round trip' })).toBeVisible({
			timeout: 15_000
		});
	});
});
