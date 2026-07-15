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
	await origin.click({ force: true, position: { x: 8, y: 8 } });
	await page.getByRole('button', { name: 'amber card color', exact: true }).click();
	await expect(amberOrigin).toBeVisible();

	await page.getByTestId('board-connect').click();
	// Cards intentionally cascade and may overlap. Dispatch to the card itself so
	// this verifies Connect semantics instead of browser hit-testing order.
	await origin.dispatchEvent('pointerdown', { button: 0, bubbles: true });
	await expect(page.getByTestId('board-connect')).toContainText('Pick end');
	await outcome.dispatchEvent('pointerdown', { button: 0, bubbles: true });
	await expect(page.locator('g[data-canvas-element]')).toHaveCount(1);

	const label = page.getByRole('textbox', { name: 'Connection label' });
	await label.fill('Depends on');
	await label.press('Enter');
	await page.getByRole('button', { name: 'blue connection' }).click();
	await page.getByRole('button', { name: 'Use dashed line' }).click();
	await page.getByTestId('board-connect').click();

	await page.reload();
	await expect(amberOrigin).toBeVisible({ timeout: 10_000 });
	const persistedArrow = page.getByRole('button', { name: 'Select connection Depends on' });
	await expect(persistedArrow).toBeVisible({ timeout: 10_000 });

	await persistedArrow.click();
	await expect(page.getByRole('textbox', { name: 'Connection label' })).toHaveValue('Depends on');
	await page.getByRole('button', { name: 'Delete connection' }).click();
	await expect(page.locator('g[data-canvas-element]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Select connection Depends on' })).toBeVisible();

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
