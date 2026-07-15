import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNamedNote, wipeIndexedDb } from './helpers';

test('colors cards and creates persistent, editable, exportable visual relationships', async ({
	page
}) => {
	test.setTimeout(90_000);
	await wipeIndexedDb(page);
	await createNamedNote(page, 'Origin', 'The starting idea.');
	await createNamedNote(page, 'Outcome', 'The idea after it moves through the system.');

	const origin = page.getByRole('group', { name: 'Origin', exact: true });
	const outcome = page.getByRole('group', { name: 'Outcome', exact: true });
	const amberOrigin = page
		.locator('[data-canvas-card][data-card-color="amber"]')
		.filter({ hasText: 'Origin' });
	const originalSurface = await origin.evaluate((element) => {
		const style = getComputedStyle(element);
		return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
	});
	await origin.click({ force: true, position: { x: 8, y: 8 } });
	await page.getByTestId('card-border-picker').locator('summary').click();
	await page.getByRole('button', { name: 'amber border color', exact: true }).click();
	await expect(amberOrigin).toBeVisible();
	await expect(amberOrigin).toHaveCSS('border-color', 'rgb(217, 164, 65)');
	await expect
		.poll(() =>
			amberOrigin.evaluate((element) => {
				const style = getComputedStyle(element);
				return { backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage };
			})
		)
		.toEqual(originalSurface);

	const arrowTool = page.getByTestId('board-arrow-tool');
	const board = page.getByRole('application', { name: 'Mash canvas' });
	const boardBox = await board.boundingBox();
	expect(boardBox).not.toBeNull();
	await page.mouse.click(boardBox!.x + boardBox!.width * 0.7, boardBox!.y + boardBox!.height * 0.7);
	await page.keyboard.down('a');
	await expect(arrowTool).toHaveAttribute('aria-pressed', 'true');
	await expect(board).toHaveClass(/is-arrow-tool/);
	await expect
		.poll(() => board.evaluate((element) => getComputedStyle(element).cursor))
		.toContain('url(');
	// A click is selection-free in the arrow tool; only a real drag commits.
	await origin.click({ force: true, position: { x: 12, y: 70 } });
	await expect(page.locator('g[data-canvas-element]')).toHaveCount(0);

	const originBox = await origin.boundingBox();
	const outcomeBox = await outcome.boundingBox();
	expect(originBox).not.toBeNull();
	expect(outcomeBox).not.toBeNull();
	const start = { x: originBox!.x + 10, y: originBox!.y + originBox!.height * 0.72 };
	const end = {
		x: outcomeBox!.x + outcomeBox!.width - 10,
		y: outcomeBox!.y + outcomeBox!.height * 0.72
	};
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
	await page.mouse.move(end.x, end.y, { steps: 5 });
	// The cards intentionally overlap when newly spawned. Assert the preview once the
	// pointer reaches the distinct target card, rather than while it is still over the source.
	await expect(page.locator('[data-connect-preview]')).toBeVisible();
	await page.mouse.up();
	await expect(page.locator('g[data-canvas-element]')).toHaveCount(1);
	await page.keyboard.up('a');
	await expect(arrowTool).toHaveAttribute('aria-pressed', 'false');
	await expect(board).not.toHaveClass(/is-arrow-tool/);

	const label = page.getByRole('textbox', { name: 'Arrow label' });
	await label.fill('Depends on');
	await label.press('Enter');
	await page.getByTestId('arrow-color-picker').locator('summary').click();
	await page.getByRole('button', { name: 'blue arrow' }).click();
	await page.getByRole('button', { name: 'Use dashed line' }).click();

	await page.reload();
	await expect(amberOrigin).toBeVisible({ timeout: 10_000 });
	const persistedArrow = page.getByRole('button', { name: 'Select arrow Depends on' });
	await expect(persistedArrow).toBeVisible({ timeout: 10_000 });

	await persistedArrow.click();
	await expect(page.getByRole('textbox', { name: 'Arrow label' })).toHaveValue('Depends on');
	await page.getByRole('button', { name: 'Delete arrow' }).click();
	await expect(page.locator('g[data-canvas-element]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Select arrow Depends on' })).toBeVisible();

	await page.getByRole('button', { name: 'Finish', exact: true }).click();
	const finish = page.getByRole('dialog', { name: 'Finish this desk' });
	const boardDownload = page.waitForEvent('download');
	await finish.getByRole('button', { name: /Board image/ }).click();
	const boardImage = await boardDownload;
	const boardImagePath = path.join(os.tmpdir(), `mash-relationships-${Date.now()}.png`);
	await boardImage.saveAs(boardImagePath);
	const boardPng = fs.readFileSync(boardImagePath);
	expect([...boardPng.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(boardPng.readUInt32BE(16)).toBeGreaterThan(0);
	expect(boardPng.readUInt32BE(20)).toBeGreaterThan(0);
	await expect(finish.getByRole('status')).toContainText('cards as a');
	fs.unlinkSync(boardImagePath);
});
