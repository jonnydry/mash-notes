import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
	confirmMashDialog,
	createNamedNote,
	openPalette,
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

		await openPalette(page, 'Export all as JSON');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: /Export all as JSON/i }).click();
		const download = await downloadPromise;
		const tmp = path.join(os.tmpdir(), `mash-smoke-${Date.now()}.json`);
		await download.saveAs(tmp);
		const raw = fs.readFileSync(tmp, 'utf8');
		expect(raw).toMatch(/Smoke Alpha/);
		expect(raw).toMatch(/mash/i);

		await openPalette(page, 'Import notes from JSON');
		const [fileChooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('button', { name: /Import notes from JSON/i }).click()
		]);
		await fileChooser.setFiles(tmp);
		await expect(page.getByText(/Imported/i).first()).toBeVisible({ timeout: 10_000 });

		fs.unlinkSync(tmp);
	});
});
