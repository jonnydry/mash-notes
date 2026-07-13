import { test, expect } from '@playwright/test';
import { createNamedNote, openNoteInStage, wipeIndexedDb } from './helpers';

test.describe('Linked peel', () => {
	test('wikilink opens Linked peel; missing target asks before create', async ({ page }) => {
		test.setTimeout(90_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Link Source', 'See [[Link Target]] and [[Brand New Idea]].');
		await createNamedNote(page, 'Link Target', 'I am the target.');

		await openNoteInStage(page, 'Link Source');
		await page.getByRole('button', { name: 'Preview' }).click();
		await expect(page.locator('.mash-sticky-preview').first()).toBeVisible();

		// Existing target: open Linked + stage, no create dialog.
		await page.locator('.mash-wikilink').filter({ hasText: 'Link Target' }).click();
		const peel = page.getByRole('complementary', { name: 'Ingredients' });
		await expect(peel).toBeVisible();
		await expect(peel.getByText('Outgoing', { exact: true })).toBeVisible();
		await expect(peel.getByText('Backlinks')).toBeVisible();
		await expect(page.locator('.mash-editor-pane-titlebar input').first()).toHaveValue(
			'Link Target',
			{ timeout: 10_000 }
		);
		await expect(page.getByRole('alertdialog')).toHaveCount(0);

		// Re-open source and click missing wikilink → confirm create.
		await openNoteInStage(page, 'Link Source');
		await page.getByRole('button', { name: 'Preview' }).click();
		await page.locator('.mash-wikilink').filter({ hasText: 'Brand New Idea' }).click();

		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByRole('heading', { name: 'Create note?' })).toBeVisible();
		await dialog.getByRole('button', { name: 'Create', exact: true }).click();
		await expect(page.getByText(/Created “Brand New Idea”/)).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('.mash-editor-pane-titlebar input').first()).toHaveValue(
			'Brand New Idea',
			{ timeout: 10_000 }
		);
	});
});
