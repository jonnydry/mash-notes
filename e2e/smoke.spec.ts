import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
	confirmMashDialog,
	createNamedNote,
	openPalette,
	redoFromViewMenu,
	selectNotesInPeel,
	wipeIndexedDb
} from './helpers';

test.describe('Mash smoke', () => {
	test('new note → mash → export → import', async ({ page }) => {
		test.setTimeout(90_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Smoke Alpha', 'Alpha body with [[Smoke Beta]]');
		await createNamedNote(page, 'Smoke Beta', 'Beta body');

		await selectNotesInPeel(page, ['Smoke Alpha', 'Smoke Beta']);

		await page.getByRole('button', { name: 'Mash', exact: true }).click();
		await confirmMashDialog(page);
		await expect(page.getByRole('group', { name: /Smoke Alpha \+ Smoke Beta/ })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByTestId('action-status')).toContainText(/Mash/);
		const mashCard = page.getByRole('group', { name: /Smoke Alpha \+ Smoke Beta/ });
		await expect(mashCard.getByText('Made from 2 sources')).toBeVisible();
		const provenance = page.getByLabel('Result provenance');
		await expect(provenance.getByRole('button', { name: 'Smoke Alpha' })).toBeVisible();
		await expect(provenance.getByRole('button', { name: 'Smoke Beta' })).toBeVisible();

		await provenance.getByRole('button', { name: 'Undo result' }).click();
		await expect(page.getByRole('group', { name: /Smoke Alpha/ })).toBeVisible();
		await expect(page.getByRole('group', { name: /Smoke Beta/ })).toBeVisible();
		await expect(page.getByTestId('action-status')).toHaveText('Undo Mash');
		// Redo is under View (quiet board chrome) — not a primary chip
		await redoFromViewMenu(page);
		await expect(mashCard).toBeVisible();
		await expect(page.getByTestId('action-status')).toHaveText('Redo Mash');

		await page.getByRole('button', { name: 'Unmash' }).click();
		await expect(page.getByRole('group', { name: /Smoke Alpha/ })).toBeVisible();
		await expect(page.getByRole('group', { name: /Smoke Beta/ })).toBeVisible();
		await expect(page.getByTestId('action-status')).toContainText('Unmashed');
		await page.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(mashCard).toBeVisible();
		await expect(page.getByTestId('action-status')).toHaveText('Undo Unmash');

		await page.getByRole('button', { name: 'Finish' }).click();
		const finishDialog = page.getByRole('dialog', { name: 'Finish this desk' });
		await expect(finishDialog.getByRole('radio', { name: /Results · 1/ })).toBeEnabled();
		await finishDialog.getByRole('button', { name: 'Close desk panel' }).click();

		await openPalette(page, 'Export all as JSON');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('option', { name: 'Export all as JSON', exact: true }).click();
		const download = await downloadPromise;
		await expect(page.getByTestId('action-status')).toContainText('Exported');
		const tmp = path.join(os.tmpdir(), `mash-smoke-${Date.now()}.json`);
		await download.saveAs(tmp);
		const raw = fs.readFileSync(tmp, 'utf8');
		expect(raw).toMatch(/Smoke Alpha/);
		expect(raw).toMatch(/mash/i);
		expect(raw).toMatch(/"operationId"/);

		await openPalette(page, 'Import notes from JSON');
		const [fileChooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('option', { name: /Import notes from JSON/i }).click()
		]);
		await fileChooser.setFiles(tmp);
		await expect(page.getByText(/Imported/i).first()).toBeVisible({ timeout: 10_000 });

		fs.unlinkSync(tmp);
	});
});
