import { expect, test, type Page } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

async function createSequencePages(page: Page) {
	await wipeIndexedDb(page);
	await createNamedNote(page, 'Opening page', 'Start here.');
	await createNamedNote(page, 'Middle page', 'Then this.');
	await createNamedNote(page, 'Closing page', 'Finish here.');
	await page.getByTestId('board-view-toggle').click();
	await page
		.getByTestId('board-view-menu')
		.getByRole('menuitem', { name: 'Organize to grid' })
		.click();
	return {
		opening: page.locator('[data-canvas-card]').filter({ hasText: 'Opening page' }),
		middle: page.locator('[data-canvas-card]').filter({ hasText: 'Middle page' }),
		closing: page.locator('[data-canvas-card]').filter({ hasText: 'Closing page' })
	};
}

test.describe('Set page order guidance', () => {
	test('shows the next page, previews targets, and names the completed sequence', async ({
		page
	}) => {
		const { opening, middle, closing } = await createSequencePages(page);

		await page.getByTestId('board-sequence').click();
		const prompt = page.getByTestId('board-sequence-prompt');
		await expect(prompt).toHaveText('Choose the first page');
		await expect(page.getByTestId('board-sequence-done')).toHaveText('Cancel');

		await opening.click();
		await expect(prompt).toHaveText('Choose page 2');
		await expect(opening.locator('.mash-flow-page-badge')).toHaveText('1');
		await expect(opening.locator('.mash-flow-page-badge')).toHaveAttribute(
			'data-provisional',
			'true'
		);

		await middle.hover();
		await expect(middle.locator('.mash-flow-page-badge')).toHaveText('2');
		await middle.click();
		await expect(prompt).toHaveText('Choose page 3');
		await expect(page.getByTestId('board-sequence-done')).toHaveText('Done');
		await expect(middle.locator('.mash-flow-page-badge')).not.toHaveAttribute(
			'data-provisional',
			'true'
		);

		await opening.click();
		await expect(page.getByTestId('action-status')).toHaveText('That link would loop');
		await expect(prompt).toHaveText('Choose page 3');

		await closing.hover();
		await expect(closing.locator('.mash-flow-page-badge')).toHaveText('3');
		await closing.click();
		await expect(prompt).toHaveText('Choose page 4');
		await page.getByTestId('board-sequence-done').click();

		await expect(page.getByTestId('board-sequence')).toHaveText('Set page order');
		await expect(opening.locator('.mash-flow-page-badge')).toHaveText('1');
		await expect(middle.locator('.mash-flow-page-badge')).toHaveText('2');
		await expect(closing.locator('.mash-flow-page-badge')).toHaveText('3');

		const options = page.getByRole('button', {
			name: 'Sequence 1, 3 pages, options'
		});
		await expect(options).toHaveText('Sequence 1 · 3');
		await options.click();
		const menu = page.getByRole('group', {
			name: 'Sequence 1, 3 pages, options'
		});
		await expect(menu.getByRole('button', { name: 'Edit order' })).toBeVisible();
		await expect(menu.getByRole('button', { name: 'Select pages' })).toBeVisible();
		const exportButton = menu.getByRole('button', { name: 'Export…' });
		await expect(exportButton).toBeVisible();
		await expect(menu.getByRole('button', { name: 'Remove page order' })).toBeVisible();

		await exportButton.click();
		const exportSheet = page.getByRole('dialog', { name: 'Export a polished document' });
		await expect(exportSheet).toBeVisible();
		await expect(exportSheet).toContainText('Sequence 1 · 3 pages');
		await expect(exportSheet.getByRole('radio', { name: /Sticky deck/ })).toBeVisible();
	});

	test('supports choosing pages with card focus and Enter', async ({ page }) => {
		const { opening, middle, closing } = await createSequencePages(page);

		await page.getByTestId('board-sequence').click();
		await opening.focus();
		await expect(opening).toBeFocused();
		await opening.press('Enter');
		await expect(page.getByTestId('board-sequence-prompt')).toHaveText('Choose page 2');

		await middle.focus();
		await middle.press('Enter');
		await expect(page.getByTestId('board-sequence-prompt')).toHaveText('Choose page 3');

		await closing.focus();
		await closing.press('Enter');
		await expect(page.getByTestId('board-sequence-prompt')).toHaveText('Choose page 4');
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('board-sequence-prompt')).toHaveText('Choose the first page');
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('board-sequence')).toBeVisible();
		await expect(opening.locator('.mash-flow-page-badge')).toHaveText('1');
		await expect(middle.locator('.mash-flow-page-badge')).toHaveText('2');
		await expect(closing.locator('.mash-flow-page-badge')).toHaveText('3');
	});
});
