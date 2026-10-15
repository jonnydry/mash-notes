import { expect, test, type Locator, type Page } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box) {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Same nodes placement measures. The toast node is only present while a toast is showing. */
async function visibleChrome(page: Page) {
	return page.evaluate(() => {
		const selectors = [
			'.mash-canvas-chrome-top',
			'.mash-canvas-chrome-pan',
			'.mash-selection-bar',
			'[data-testid="action-status"]'
		];
		const boxes: Array<Box & { selector: string }> = [];
		for (const selector of selectors) {
			for (const el of document.querySelectorAll(selector)) {
				const box = el.getBoundingClientRect();
				if (box.width <= 0 || box.height <= 0) continue;
				boxes.push({
					selector,
					x: box.x,
					y: box.y,
					width: box.width,
					height: box.height
				});
			}
		}
		return boxes;
	});
}

async function layoutBox(locator: Locator): Promise<Box> {
	await expect(locator).toBeVisible();
	return locator.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	});
}

async function assertHeaderClearsChrome(page: Page, header: Locator, collapse: Locator) {
	const headerBox = await layoutBox(header);
	const collapseBox = await layoutBox(collapse);
	expect(headerBox.width).toBeGreaterThan(0);
	expect(collapseBox.width).toBeGreaterThan(0);
	const chrome = await visibleChrome(page);
	expect(chrome.some((box) => box.selector === '.mash-canvas-chrome-top')).toBe(true);
	expect(chrome.some((box) => box.selector === '.mash-canvas-chrome-pan')).toBe(true);
	expect(chrome.some((box) => box.selector === '.mash-selection-bar')).toBe(true);
	for (const obstacle of chrome) {
		expect(intersects(headerBox, obstacle), obstacle.selector).toBe(false);
		expect(intersects(collapseBox, obstacle), obstacle.selector).toBe(false);
	}
}

test('new cards stay clear of floating chrome on a busy desk', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();

	const world = page.getByRole('application', { name: 'Mash canvas' }).locator('> div').first();
	const transformBefore = await world.evaluate(
		(element) => (element as HTMLElement).style.transform
	);
	const newNote = page.getByRole('button', { name: 'New note' });

	const expanded = page.locator('[data-canvas-card][data-expanded="true"]');
	const toast = page.getByTestId('action-status');

	async function placeAndCheck(expectToast: boolean) {
		const before = await page.locator('[data-canvas-card]').count();
		await newNote.click();
		await expect(page.locator('[data-canvas-card]')).toHaveCount(before + 1, { timeout: 10_000 });
		await expect(expanded).toHaveCount(1, { timeout: 10_000 });
		await expect(expanded).toHaveCSS('width', '280px', { timeout: 10_000 });
		await expect(toast).toBeVisible();
		if (expectToast) await expect(toast).toContainText('Dropped');
		await assertHeaderClearsChrome(
			page,
			expanded.locator('.mash-card-header'),
			expanded.getByRole('button', { name: 'Collapse sticky' })
		);
	}

	await placeAndCheck(true);
	for (let i = 0; i < 17; i++) await placeAndCheck(false);

	expect(await world.evaluate((element) => (element as HTMLElement).style.transform)).toBe(
		transformBefore
	);
	expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);
});
