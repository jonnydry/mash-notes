import { expect, test } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

const WIDTHS = [320, 390, 450, 768];

test('keeps the selection bar fully on screen at narrow widths', async ({ page }) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await wipeIndexedDb(page);
	await createNamedNote(page, 'Bar Width', 'Selected so the bar is showing.');

	const bar = page.locator('.mash-selection-bar');
	await expect(bar).toBeVisible();

	for (const width of WIDTHS) {
		await page.setViewportSize({ width, height: 800 });
		await expect(bar).toBeVisible();
		const box = await bar.boundingBox();
		expect(box, `selection bar box at ${width}px`).not.toBeNull();
		expect(box!.x, `left edge at ${width}px`).toBeGreaterThanOrEqual(-1);
		expect(box!.y, `top edge at ${width}px`).toBeGreaterThanOrEqual(-1);
		expect(box!.x + box!.width, `right edge at ${width}px`).toBeLessThanOrEqual(width + 1);
		expect(box!.y + box!.height, `bottom edge at ${width}px`).toBeLessThanOrEqual(800 + 1);
	}
});
