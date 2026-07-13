import { expect, test, type Page } from '@playwright/test';
import { modKey, openPalette, wipeIndexedDb } from './helpers';

async function pasteText(page: Page, text: string) {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	// Close peel if open so it doesn't intercept canvas clicks (wipe opens Desk peel).
	await page.keyboard.press('Escape');
	const canvas = page.getByRole('application', { name: 'Mash canvas' });
	await canvas.click({ position: { x: 520, y: 360 }, force: true });
	await page.keyboard.press(`${modKey()}+V`);
}

/** Redo lives under View after quiet board chrome. */
async function redoLayout(page: Page) {
	await page.getByTestId('board-view-toggle').click();
	await page.getByTestId('board-view-menu').getByRole('menuitem', { name: 'Redo layout' }).click();
}

test.describe('Set operators', () => {
	test('splits one card into traced fragments and restores notes on undo and redo', async ({
		page
	}) => {
		await wipeIndexedDb(page);

		await pasteText(page, 'Alpha\nBeta\nGamma');
		await page
			.getByRole('dialog', { name: 'How should this land?' })
			.getByRole('button', { name: 'One card' })
			.click();
		await expect(page.locator('.mash-note-card')).toHaveCount(1);
		await page.getByTestId('operator-kitchen-toggle').click();
		await expect(page.getByTestId('operator-kitchen')).toBeVisible();
		await expect(page.getByTestId('operator-kitchen').getByText('Shape')).toBeVisible();
		await expect(page.locator('[data-action-id="split-selection-lines"]')).toBeVisible();
		await page.locator('[data-action-id="split-selection-lines"]').click();
		await expect(page.locator('.mash-note-card')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toContainText('Split by lines');
		await expect(page.getByTestId('operator-receipt')).toBeVisible();
		await expect(page.getByTestId('operator-receipt-summary')).toContainText('1 → 3');

		// Prefer receipt undo when the durable op is top of stack (disambiguates board chrome Undo).
		await page.getByTestId('operator-receipt-undo').click();
		await expect(page.locator('.mash-note-card')).toHaveCount(1);
		await expect(page.getByTestId('action-status')).toHaveText('Undo Split');

		await redoLayout(page);
		await expect(page.locator('.mash-note-card')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toHaveText('Redo Split');
	});

	test('shares reversible layout, content, stack, and sequence actions across surfaces', async ({
		page
	}) => {
		await wipeIndexedDb(page);

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
		const paletteShuffle = page.getByRole('option', { name: 'Shuffle selected cards' });
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

		await redoLayout(page);
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
		await expect(page.getByTestId('action-status')).toContainText('Sequenced 3 cards');
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(page.locator('.mash-flow-page-badge')).toHaveCount(0);
		await expect(page.getByTestId('action-status')).toHaveText('Undo Sequence');
		await redoLayout(page);
		await expect(page.locator('.mash-flow-page-badge')).toHaveCount(3);
		await expect(page.getByTestId('action-status')).toHaveText('Redo Sequence');
	});
});
