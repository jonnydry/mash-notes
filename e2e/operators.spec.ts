import { expect, test, type Page } from '@playwright/test';
import { modKey, openPalette, wipeIndexedDb } from './helpers';

async function pasteText(page: Page, text: string) {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await page
		.getByRole('application', { name: 'Mash canvas' })
		.click({ position: { x: 340, y: 320 } });
	await page.keyboard.press(`${modKey()}+V`);
}

test.describe('Set operators', () => {
	test('splits one card into traced fragments and restores notes on undo and redo', async ({
		page
	}) => {
		await wipeIndexedDb(page);
		await page.getByRole('button', { name: 'Open session manager' }).click();
		await page.getByRole('button', { name: 'New scratch desk' }).click();

		await pasteText(page, 'Alpha\nBeta\nGamma');
		await page
			.getByRole('dialog', { name: 'How should this land?' })
			.getByRole('button', { name: 'One card' })
			.click();
		await expect(page.locator('.mash-note-card')).toHaveCount(1);
		await page.getByRole('button', { name: 'Transform' }).click();
		await expect(page.locator('[data-action-id="split-selection-lines"]')).toBeVisible();
		await page.locator('[data-action-id="split-selection-lines"]').click();
		await expect(page.locator('.mash-note-card')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toContainText('Split into 3 cards by lines');

		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(page.locator('.mash-note-card')).toHaveCount(1);
		await expect(page.getByTestId('action-status')).toHaveText('Undo Split');

		await page.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(page.locator('.mash-note-card')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toHaveText('Redo Split');
	});

	test('shares reversible layout, content, stack, and sequence actions across surfaces', async ({
		page
	}) => {
		await wipeIndexedDb(page);
		await page.getByRole('button', { name: 'Open session manager' }).click();
		await page.getByRole('button', { name: 'New scratch desk' }).click();

		await pasteText(page, 'Zulu\nSame\nAlpha\nSame');
		await page
			.getByRole('dialog', { name: 'How should this land?' })
			.getByRole('button', { name: /4 line cards/ })
			.click();
		await expect(page.locator('.mash-note-card')).toHaveCount(4);
		const layoutBeforeShuffle = await page.locator('.mash-note-card').evaluateAll((cards) =>
			cards.map((card) => ({
				text: card.textContent,
				left: (card as HTMLElement).style.left,
				top: (card as HTMLElement).style.top
			}))
		);

		await openPalette(page, 'Shuffle selected cards');
		const paletteShuffle = page.getByRole('button', { name: 'Shuffle selected cards' });
		await expect(paletteShuffle).toBeVisible();
		await paletteShuffle.click();
		await expect(page.getByTestId('action-status')).toContainText('Shuffle');
		const layoutAfterShuffle = await page.locator('.mash-note-card').evaluateAll((cards) =>
			cards.map((card) => ({
				text: card.textContent,
				left: (card as HTMLElement).style.left,
				top: (card as HTMLElement).style.top
			}))
		);
		expect(layoutAfterShuffle).not.toEqual(layoutBeforeShuffle);
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(page.getByTestId('action-status')).toHaveText('Undo Shuffle');

		await page.getByRole('button', { name: 'Transform' }).click();
		await page.locator('[data-action-id="deduplicate-selection"]').click();
		await expect(page.locator('.mash-note-card')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toContainText('Removed 1 duplicate card');

		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(page.locator('.mash-note-card')).toHaveCount(4);
		await expect(page.getByTestId('action-status')).toHaveText('Undo Deduplicate');

		await page.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(page.locator('.mash-note-card')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toHaveText('Redo Deduplicate');

		const layoutBeforeStack = await page.locator('.mash-note-card').evaluateAll((cards) =>
			cards.map((card) => ({
				left: (card as HTMLElement).style.left,
				top: (card as HTMLElement).style.top
			}))
		);
		await page.getByRole('button', { name: 'Transform' }).click();
		await expect(page.locator('[data-action-id="spread-selection"]')).toBeVisible();
		await expect(page.locator('[data-action-id="sequence-selection"]')).toBeVisible();
		await page.locator('[data-action-id="stack-selection"]').click();
		await expect(page.getByTestId('action-status')).toContainText('Stack');
		const layoutAfterStack = await page.locator('.mash-note-card').evaluateAll((cards) =>
			cards.map((card) => ({
				left: (card as HTMLElement).style.left,
				top: (card as HTMLElement).style.top
			}))
		);
		expect(layoutAfterStack).not.toEqual(layoutBeforeStack);
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(page.getByTestId('action-status')).toHaveText('Undo Stack');

		await page.getByRole('button', { name: 'Transform' }).click();
		await page.locator('[data-action-id="sequence-selection"]').click();
		await expect(page.locator('.mash-flow-page-badge')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toContainText(
			'Sequenced 3 cards in reading order'
		);
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(page.locator('.mash-flow-page-badge')).toHaveCount(0);
		await expect(page.getByTestId('action-status')).toHaveText('Undo Sequence');
		await page.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(page.locator('.mash-flow-page-badge')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toHaveText('Redo Sequence');
	});
});
