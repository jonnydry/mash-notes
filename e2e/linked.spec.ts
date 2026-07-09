import { test, expect } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

async function openNoteFromPeel(page: import('@playwright/test').Page, title: string) {
	await page.getByRole('button', { name: 'Desk' }).click();
	const peel = page.getByRole('complementary', { name: 'Note scanner' });
	await expect(peel).toBeVisible();
	const titleBtn = peel
		.getByRole('option')
		.filter({ hasText: title })
		.getByRole('button')
		.nth(1);
	await titleBtn.click();
	await titleBtn.press('Enter');
	await expect(page.locator('textarea.mash-sticky-body').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Linked peel', () => {
	test('wikilink opens Linked peel; missing target asks before create', async ({ page }) => {
		test.setTimeout(90_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Link Source', 'See [[Link Target]] and [[Brand New Idea]].');
		await createNamedNote(page, 'Link Target', 'I am the target.');

		await openNoteFromPeel(page, 'Link Source');
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.locator('.mash-sticky-preview').first()).toBeVisible();

		// Existing target: open Linked + sticky, no create dialog.
		await page.locator('.mash-wikilink').filter({ hasText: 'Link Target' }).click();
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		await expect(peel).toBeVisible();
		await expect(peel.getByText('Outgoing', { exact: true })).toBeVisible();
		await expect(peel.getByText('Backlinks')).toBeVisible();
		await expect(page.getByRole('group', { name: 'Link Target' })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('alertdialog')).toHaveCount(0);

		// Re-open source and click missing wikilink → confirm create.
		await openNoteFromPeel(page, 'Link Source');
		await page.getByRole('button', { name: 'Preview' }).click();
		await page.locator('.mash-wikilink').filter({ hasText: 'Brand New Idea' }).click();

		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByRole('heading', { name: 'Create note?' })).toBeVisible();
		await dialog.getByRole('button', { name: 'Create', exact: true }).click();
		await expect(page.getByText(/Created “Brand New Idea”/)).toBeVisible({ timeout: 10_000 });
		await expect(page.getByRole('group', { name: 'Brand New Idea' })).toBeVisible({
			timeout: 10_000
		});
	});
});
