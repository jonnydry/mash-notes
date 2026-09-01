import { test, expect } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test('reopens the cached desk and local notes while offline', async ({ page, context }) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);

	const manifest = page.locator('link[rel="manifest"]');
	await expect(manifest).toHaveAttribute('href', /manifest\.webmanifest$/);

	await page.waitForFunction(
		async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
		undefined,
		{ timeout: 30_000 }
	);

	// A controlling reload proves this page is using the installed worker before
	// the network is removed; merely seeing a registration is not enough.
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
		timeout: 15_000
	});

	await createNamedNote(page, 'Offline contract', 'This note must survive a network-free reopen.');

	await context.setOffline(true);
	try {
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
			timeout: 30_000
		});
		// Playwright 1.62 Chromium leaves navigator.onLine true after navigation
		// in an already-offline context (microsoft/playwright#42174). Re-toggle
		// on the live page so the offline flag matches the blocked network.
		await context.setOffline(false);
		await context.setOffline(true);
		await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

		await page.getByRole('button', { name: 'Desk', exact: true }).click();
		const ingredients = page.getByRole('complementary', { name: 'Ingredients' });
		await expect(ingredients.getByText('Offline contract')).toBeVisible({ timeout: 15_000 });
	} finally {
		await context.setOffline(false);
	}
});
