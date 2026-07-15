import { expect, test } from '@playwright/test';
import { createNamedNote, selectNotesInPeel, wipeIndexedDb } from './helpers';

test('keeps a failed confirmation available for a clean retry', async ({ page }) => {
	await wipeIndexedDb(page);
	await createNamedNote(page, 'Retry deletion', 'This note survives the first failed write.');
	await selectNotesInPeel(page, ['Retry deletion']);
	await page.getByRole('button', { name: 'Close ingredients' }).click();

	const card = page.getByRole('group', { name: 'Retry deletion' });
	const selectionBar = page.locator('.mash-dock').filter({ hasText: '1 selected' });
	await selectionBar.getByRole('button', { name: 'Delete selected' }).click();
	const dialog = page.getByRole('alertdialog', { name: 'Delete note' });
	const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
	await expect(dialog).toBeVisible();

	await page.evaluate(() => {
		const originalPut = IDBObjectStore.prototype.put;
		(
			window as Window & {
				__mashRestoreIdbPut?: () => void;
			}
		).__mashRestoreIdbPut = () => {
			IDBObjectStore.prototype.put = originalPut;
		};
		IDBObjectStore.prototype.put = function failedPut() {
			throw new DOMException('Synthetic write failure', 'QuotaExceededError');
		};
	});

	await confirm.click();
	await expect(page.getByText('That action could not finish. Please try again.')).toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(confirm).toBeEnabled();
	await expect(card).toBeVisible();

	await page.evaluate(() => {
		(
			window as Window & {
				__mashRestoreIdbPut?: () => void;
			}
		).__mashRestoreIdbPut?.();
	});
	await confirm.click();
	await expect(dialog).toBeHidden();
	await expect(card).toBeHidden();
});
