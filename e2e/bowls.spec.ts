import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test('creates, renames, selects, and dissolves a bowl', async ({ page }) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);
	await page.evaluate(() => localStorage.removeItem('mash.tryAMashDismissed'));
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	await page.keyboard.press('Escape');

	await page.getByTestId('try-a-mash').click();
	await expect(page.getByTestId('selection-bowl')).toBeVisible({ timeout: 10_000 });
	await page.getByTestId('selection-bowl').click();

	const bowl = page.locator('.mash-canvas-bowl');
	await expect(bowl).toBeVisible();
	const name = bowl.getByRole('textbox', { name: 'Bowl name' });
	await expect(name).toBeFocused();
	await name.fill('Research');
	await name.press('Enter');
	await expect(name).toHaveValue('Research');
	await expect(bowl.locator('.mash-canvas-bowl-count')).toHaveText('2');

	const cards = page.locator('[data-canvas-card]');
	const beforeBowlMove = await Promise.all([
		cards.nth(0).boundingBox(),
		cards.nth(1).boundingBox()
	]);
	const grip = await bowl.locator('.mash-canvas-bowl-grip').boundingBox();
	expect(grip).not.toBeNull();
	await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
	await page.mouse.down();
	await page.mouse.move(grip!.x + grip!.width / 2 + 80, grip!.y + grip!.height / 2 + 40, {
		steps: 6
	});
	await page.mouse.up();
	await page.waitForTimeout(250);
	const afterBowlMove = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
	for (let i = 0; i < 2; i += 1) {
		expect(afterBowlMove[i]!.x - beforeBowlMove[i]!.x).toBeCloseTo(80, 0);
		expect(afterBowlMove[i]!.y - beforeBowlMove[i]!.y).toBeCloseTo(40, 0);
	}

	const firstBeforeCardMove = afterBowlMove[0]!;
	const secondBeforeCardMove = afterBowlMove[1]!;
	await page.mouse.move(firstBeforeCardMove.x + 30, firstBeforeCardMove.y + 60);
	await page.mouse.down();
	await page.mouse.move(firstBeforeCardMove.x + 90, firstBeforeCardMove.y + 30, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(250);
	const firstAfterCardMove = await cards.nth(0).boundingBox();
	const secondAfterCardMove = await cards.nth(1).boundingBox();
	expect(firstAfterCardMove!.x - firstBeforeCardMove.x).toBeCloseTo(60, 0);
	expect(firstAfterCardMove!.y - firstBeforeCardMove.y).toBeCloseTo(-30, 0);
	expect(secondAfterCardMove!.x).toBeCloseTo(secondBeforeCardMove.x, 0);
	expect(secondAfterCardMove!.y).toBeCloseTo(secondBeforeCardMove.y, 0);

	const selectGrip = await bowl.locator('.mash-canvas-bowl-grip').boundingBox();
	expect(selectGrip).not.toBeNull();
	await page.mouse.click(
		selectGrip!.x + selectGrip!.width / 2,
		selectGrip!.y + selectGrip!.height / 2
	);
	await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Dissolve bowl Research' }).click();
	await expect(page.locator('.mash-canvas-bowl')).toHaveCount(0);
	await expect(page.getByRole('group', { name: /Half-baked idea/ })).toBeVisible();
	await expect(page.getByRole('group', { name: /Another scrap/ })).toBeVisible();
});
