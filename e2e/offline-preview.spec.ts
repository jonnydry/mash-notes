import { expect, test } from '@playwright/test';
import { createNamedNote, openNoteInStage, wipeIndexedDb } from './helpers';

test('renders markdown preview offline after one online load', async ({ page, context }) => {
	test.setTimeout(90_000);
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await wipeIndexedDb(page);

	await page.waitForFunction(
		async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
		undefined,
		{ timeout: 30_000 }
	);
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
		timeout: 15_000
	});

	// The chunk is precached at install, before Preview is ever opened.
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const names = await caches.keys();
				for (const name of names) {
					if (!name.includes('precache')) continue;
					const cache = await caches.open(name);
					for (const request of await cache.keys()) {
						if (!request.url.includes('.js')) continue;
						const body = await (await cache.match(request))?.text();
						if (body?.includes('mash-marked-runtime-v1')) return true;
					}
				}
				return false;
			})
		)
		.toBe(true);

	await createNamedNote(page, 'Offline preview', 'Cook **Mash** with [[Desk notes]].');

	await context.setOffline(true);
	try {
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
			timeout: 30_000
		});
		await context.setOffline(false);
		await context.setOffline(true);
		await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

		await openNoteInStage(page, 'Offline preview');
		await page.getByRole('button', { name: 'Preview' }).click();
		const preview = page.locator('.mash-sticky-preview').first();
		await expect(preview.locator('strong').filter({ hasText: 'Mash' })).toBeVisible({
			timeout: 15_000
		});
		await expect(preview.locator('.mash-wikilink').filter({ hasText: 'Desk notes' })).toBeVisible();
		expect(pageErrors).toEqual([]);
	} finally {
		await context.setOffline(false);
	}
});
