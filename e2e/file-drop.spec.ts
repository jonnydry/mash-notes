import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('External file drop', () => {
	test('imports text files and places their cards at the drop point', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const canvas = page.getByRole('application', { name: 'Mash canvas' });
		const dataTransfer = await page.evaluateHandle(() => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(['# Dragged Markdown\n\nImported from outside Mash.'], 'dragged.md', {
					type: 'text/markdown'
				})
			);
			transfer.items.add(
				new File(['Plain text from Finder.'], 'outside.txt', { type: 'text/plain' })
			);
			return transfer;
		});

		await canvas.dispatchEvent('dragover', { dataTransfer });
		await expect(page.getByText('Drop files to import')).toBeVisible();

		await canvas.dispatchEvent('drop', {
			dataTransfer,
			clientX: 520,
			clientY: 360
		});

		await expect(page.getByRole('group', { name: 'Dragged Markdown' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByRole('group', { name: 'outside' })).toBeVisible();
		await expect(page.getByText('Imported 2 notes from 2 files')).toBeVisible();
		await expect(page.getByText('Drop files to import')).toBeHidden();

		await dataTransfer.dispose();
	});
});
