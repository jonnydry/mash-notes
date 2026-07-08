import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

async function createNamedNote(page: import('@playwright/test').Page, title: string, body: string) {
	await page.getByRole('button', { name: 'New note' }).click();
	await expect(page.locator('[data-drag-handle] input').first()).toBeVisible({ timeout: 10_000 });
	await page.locator('[data-drag-handle] input').first().fill(title);
	await page.locator('textarea.mash-sticky-body').first().fill(body);
	await page.getByRole('button', { name: 'Collapse sticky' }).click();
	await expect(page.getByRole('group', { name: title })).toBeVisible({ timeout: 5_000 });
	// Wait for settle animation so cards stop moving
	await page.waitForTimeout(400);
}

test.describe('Mash smoke', () => {
	test('new note → mash → export → import', async ({ page }) => {
		test.setTimeout(90_000);
		await page.goto('/');
		await page.evaluate(async () => {
			const dbs = (await indexedDB.databases?.()) ?? [];
			await Promise.all(
				dbs.map(
					(db) =>
						new Promise<void>((resolve) => {
							if (!db.name) {
								resolve();
								return;
							}
							const req = indexedDB.deleteDatabase(db.name);
							req.onsuccess = () => resolve();
							req.onerror = () => resolve();
							req.onblocked = () => resolve();
						})
				)
			);
		});
		await page.reload();
		await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
			timeout: 30_000
		});

		await createNamedNote(page, 'Smoke Alpha', 'Alpha body with [[Smoke Beta]]');
		await createNamedNote(page, 'Smoke Beta', 'Beta body');

		// Select via peel (canvas cards may overlap after spawn)
		await page.getByRole('button', { name: 'Desk' }).click();
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		await expect(peel).toBeVisible();

		const alphaBtn = peel
			.getByRole('option')
			.filter({ hasText: 'Smoke Alpha' })
			.getByRole('button')
			.nth(1);
		const betaBtn = peel
			.getByRole('option')
			.filter({ hasText: 'Smoke Beta' })
			.getByRole('button')
			.nth(1);
		await alphaBtn.click();
		await betaBtn.click({ modifiers: process.platform === 'darwin' ? ['Meta'] : ['Control'] });
		await expect(page.getByText('2 selected')).toBeVisible();

		await page.getByRole('button', { name: 'Mash', exact: true }).click();
		await expect(page.getByRole('group', { name: /Smoke Alpha \+ Smoke Beta/ })).toBeVisible({
			timeout: 15_000
		});

		await page.keyboard.press('Meta+k');
		const palette = page.getByPlaceholder('Type a command…');
		await expect(palette).toBeVisible();
		await palette.fill('Export all as JSON');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: /Export all as JSON/i }).click();
		const download = await downloadPromise;
		const tmp = path.join(os.tmpdir(), `mash-smoke-${Date.now()}.json`);
		await download.saveAs(tmp);
		const raw = fs.readFileSync(tmp, 'utf8');
		expect(raw).toMatch(/Smoke Alpha/);
		expect(raw).toMatch(/mash/i);

		await page.keyboard.press('Meta+k');
		await page.getByPlaceholder('Type a command…').fill('Import notes from JSON');
		const [fileChooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('button', { name: /Import notes from JSON/i }).click()
		]);
		await fileChooser.setFiles(tmp);
		await expect(page.getByText(/Imported/i).first()).toBeVisible({ timeout: 10_000 });

		fs.unlinkSync(tmp);
	});
});
