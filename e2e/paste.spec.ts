import { expect, test, type Page } from '@playwright/test';
import { modKey, wipeIndexedDb } from './helpers';

async function pasteText(page: Page, text: string) {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await page
		.getByRole('application', { name: 'Mash canvas' })
		.click({ position: { x: 320, y: 320 } });
	await page.keyboard.press(`${modKey()}+V`);
}

test.describe('Paste to cards', () => {
	test('captures one line instantly and splits a list into a set', async ({ page }) => {
		await wipeIndexedDb(page);
		await page.getByRole('button', { name: 'Open session manager' }).click();
		await page.getByRole('button', { name: 'New scratch desk' }).click();

		await expect(page.getByText('Paste, drop, or type')).toBeVisible();
		await pasteText(page, 'A quick pasted thought');
		await expect(
			page.getByRole('group', { name: 'A quick pasted thought, selected' })
		).toBeVisible();

		await page.getByRole('button', { name: 'Clear selection' }).click();
		await pasteText(page, '- Alpha option\n- Beta option\n- Gamma option');
		const dialog = page.getByRole('dialog', { name: 'How should this land?' });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: /3 line cards/ }).click();

		await expect(page.getByRole('group', { name: 'Alpha option, selected' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Beta option, selected' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Gamma option, selected' })).toBeVisible();
	});
});
