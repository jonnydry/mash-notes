import { expect, test, type Page } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

async function cardPositions(page: Page) {
	return page.locator('[data-canvas-card]').evaluateAll((elements) =>
		elements.map((element) => ({
			id: element.getAttribute('data-note-id'),
			left: (element as HTMLElement).style.left,
			top: (element as HTMLElement).style.top
		}))
	);
}

/** Fill the expanded new-note card and leave it open so neighbors stay bumped. */
async function leaveExpandedNote(page: Page, title: string, body: string) {
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();
	await page.getByRole('button', { name: 'New note' }).click();
	const card = page
		.locator('[data-canvas-card]')
		.filter({ has: page.locator('textarea.mash-sticky-body') })
		.first();
	await expect(card).toBeVisible({ timeout: 10_000 });
	await card.locator('input[type="text"]').first().fill(title);
	const bodyEl = card.locator('textarea.mash-sticky-body');
	await bodyEl.fill(body);
	await bodyEl.blur();
	await page.waitForTimeout(600);
}

test('selecting and deselecting cards does not move them', async ({ page }) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	await createNamedNote(page, 'Pile Alpha', 'One');
	await createNamedNote(page, 'Pile Beta', 'Two');
	await leaveExpandedNote(page, 'Pile Gamma', 'Three');

	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur?.();
	});
	const board = page.getByRole('application', { name: 'Mash canvas' });
	await board.hover();
	await page.keyboard.press('Control+a');
	await expect(page.locator('.mash-selection-bar')).toContainText(/[2-9]\d* selected/);

	const before = await cardPositions(page);
	expect(before.length).toBeGreaterThanOrEqual(3);

	const point = await board.evaluate((element) => {
		const boardRect = element.getBoundingClientRect();
		const cards = [...document.querySelectorAll('[data-canvas-card]')].map((card) =>
			card.getBoundingClientRect()
		);
		for (let y = 12; y < boardRect.height - 12; y += 20) {
			for (let x = 12; x < boardRect.width - 12; x += 20) {
				const clientX = boardRect.left + x;
				const clientY = boardRect.top + y;
				const hitsCard = cards.some(
					(card) =>
						clientX >= card.left &&
						clientX <= card.right &&
						clientY >= card.top &&
						clientY <= card.bottom
				);
				if (!hitsCard) return { x, y };
			}
		}
		return null;
	});
	expect(point).not.toBeNull();
	await board.click({ position: point! });
	await page.waitForTimeout(500);

	expect(await cardPositions(page)).toEqual(before);
	await expect(page.locator('.mash-selection-bar')).toHaveCount(0);
});
