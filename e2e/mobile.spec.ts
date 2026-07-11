import { expect, test, type Page } from '@playwright/test';
import { modKey, wipeIndexedDb } from './helpers';

async function pasteText(page: Page, text: string) {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await page
		.getByRole('application', { name: 'Mash canvas' })
		.click({ position: { x: 180, y: 300 } });
	await page.keyboard.press(`${modKey()}+V`);
}

test.describe('Mobile canvas controls', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('fits a reopened desk and keeps secondary controls out of the primary canvas', async ({
		page
	}) => {
		await wipeIndexedDb(page);
		await page.getByRole('button', { name: 'More navigation' }).click();
		await page.locator('.mash-dock-more-menu').getByRole('button', { name: 'Desks' }).click();
		const closeTarget = await page
			.getByRole('dialog', { name: 'Your desks' })
			.getByRole('button', { name: 'Close desk panel' })
			.boundingBox();
		expect(closeTarget?.width).toBeGreaterThanOrEqual(44);
		expect(closeTarget?.height).toBeGreaterThanOrEqual(44);
		await page.getByRole('button', { name: 'New scratch desk' }).click();

		await pasteText(page, '- Mobile alpha\n- Mobile beta\n- Mobile gamma');
		await page
			.getByRole('dialog', { name: 'How should this land?' })
			.getByRole('button', { name: /3 line cards/ })
			.click();
		await expect(page.getByRole('group', { name: 'Mobile alpha, selected' })).toBeVisible();

		await expect(page.locator('.mash-canvas-chrome-mobile')).toBeVisible();
		await expect(page.locator('.mash-canvas-chrome-top')).toBeHidden();
		await expect(page.locator('.mash-canvas-chrome-pan')).toBeHidden();
		await expect(page.getByRole('button', { name: 'More navigation' })).toBeVisible();

		await page.getByRole('button', { name: 'More canvas tools' }).click();
		await expect(page.getByRole('button', { name: 'Free placement' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
		await page.getByRole('button', { name: 'More canvas tools' }).click();

		await page.getByRole('button', { name: 'More navigation' }).click();
		const moreMenu = page.locator('.mash-dock-more-menu');
		await expect(moreMenu.getByRole('button', { name: 'Settings' })).toBeVisible();
		await expect(moreMenu.getByRole('button', { name: 'Folders' })).toBeVisible();

		await page.waitForTimeout(350);
		await page.evaluate(() => {
			const key = Object.keys(localStorage).find((candidate) =>
				candidate.startsWith('mash.canvasViewport.')
			);
			if (!key) throw new Error('Expected a saved canvas viewport');
			localStorage.setItem(key, JSON.stringify({ panX: -8000, panY: -8000, scale: 2 }));
		});
		await page.reload();
		await expect(page.getByRole('group', { name: /Mobile alpha/ })).toBeVisible();

		const canvasBox = await page.getByRole('application', { name: 'Mash canvas' }).boundingBox();
		const cardBox = await page.getByRole('group', { name: /Mobile alpha/ }).boundingBox();
		expect(canvasBox).not.toBeNull();
		expect(cardBox).not.toBeNull();
		expect(cardBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
		expect(cardBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
		expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width + 1);
		expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height + 1);
	});
});
