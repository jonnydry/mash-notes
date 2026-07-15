import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test('typing on the desk and New note both start in the note body', async ({ page }) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);
	await page.keyboard.press('Escape');

	await page.keyboard.press('H');
	const body = page.getByPlaceholder('Write here… Use [[Note title]] for links.');
	await expect(body).toBeFocused({ timeout: 10_000 });
	await page.keyboard.type('ello');
	await expect(body).toHaveValue('Hello');
	await page.keyboard.type(' again');
	await expect(body).toHaveValue('Hello again');
	await expect(page.getByTestId('board-arrow-tool')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('[data-canvas-card] input[type="text"]').first()).toHaveValue(
		'Untitled'
	);

	await page.getByRole('button', { name: 'Collapse sticky' }).click();
	for (let i = 0; i < 6; i++) {
		await page.getByRole('button', { name: 'Zoom in' }).click();
	}
	await page.getByRole('button', { name: 'New note' }).click();
	const title = page.locator('[data-canvas-card] input[type="text"]').first();
	await expect(body).toBeFocused();
	await page.keyboard.type('New note body');
	await expect(body).toHaveValue('New note body');
	await expect(title).toHaveValue('Untitled');
	await page.getByRole('button', { name: 'View board tools' }).click();
	await expect(page.getByText('100%', { exact: true })).toBeVisible();
});

test('repeated New note keeps canonical sizes and background cards select and drag cleanly', async ({
	page
}) => {
	await wipeIndexedDb(page);

	const newNote = page.getByRole('button', { name: 'New note' });
	await newNote.click();
	await newNote.click();

	const cards = page.locator('[data-canvas-card]');
	const expanded = page.locator('[data-canvas-card][data-expanded="true"]');
	const collapsed = page.locator('[data-canvas-card]:not([data-expanded])');
	await expect(cards).toHaveCount(2);
	await expect(expanded).toHaveCount(1);
	await expect(collapsed).toHaveCount(1);
	await expect(expanded).toHaveCSS('width', '280px');
	await expect(expanded).toHaveCSS('height', '220px');
	await expect(collapsed).toHaveCSS('width', '220px');
	await expect(collapsed).toHaveCSS('height', '120px');

	const collapsedBox = await collapsed.boundingBox();
	const expandedBox = await expanded.boundingBox();
	expect(collapsedBox).not.toBeNull();
	expect(expandedBox).not.toBeNull();
	const exposedPoint = [
		{ x: collapsedBox!.x + 8, y: collapsedBox!.y + 8 },
		{ x: collapsedBox!.x + collapsedBox!.width - 8, y: collapsedBox!.y + 8 },
		{ x: collapsedBox!.x + 8, y: collapsedBox!.y + collapsedBox!.height - 8 },
		{
			x: collapsedBox!.x + collapsedBox!.width - 8,
			y: collapsedBox!.y + collapsedBox!.height - 8
		}
	].find(
		(point) =>
			point.x < expandedBox!.x ||
			point.x > expandedBox!.x + expandedBox!.width ||
			point.y < expandedBox!.y ||
			point.y > expandedBox!.y + expandedBox!.height
	);
	expect(exposedPoint).toBeDefined();
	await page.mouse.click(exposedPoint!.x, exposedPoint!.y);
	await expect(collapsed).toHaveClass(/is-selected/);
	await expect
		.poll(async () => {
			const collapsedZ = Number(
				await collapsed.evaluate((element) => getComputedStyle(element).zIndex)
			);
			const expandedZ = Number(
				await expanded.evaluate((element) => getComputedStyle(element).zIndex)
			);
			return collapsedZ - expandedZ;
		})
		.toBeGreaterThan(0);

	const beforeDrag = await collapsed.boundingBox();
	const grip = collapsed.locator('.mash-card-grab-handle');
	await expect(grip).toBeVisible();
	const gripBox = await grip.boundingBox();
	expect(beforeDrag).not.toBeNull();
	expect(gripBox).not.toBeNull();
	await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		gripBox!.x + gripBox!.width / 2 + 60,
		gripBox!.y + gripBox!.height / 2 + 40,
		{
			steps: 5
		}
	);
	await page.mouse.up();
	await expect
		.poll(async () => {
			const afterDrag = await collapsed.boundingBox();
			return afterDrag
				? afterDrag.x - beforeDrag!.x > 50 && afterDrag.y - beforeDrag!.y > 30
				: false;
		})
		.toBe(true);
});
