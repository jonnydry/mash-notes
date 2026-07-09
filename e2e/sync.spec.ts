import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('Sync bundle', () => {
	test('import sync bundle restores notes into an empty vault', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const now = Date.now();
		const bundle = {
			version: 2,
			exportedAt: now,
			notes: [
				{
					id: 'sync-alpha-e2e',
					title: 'Sync Alpha',
					body: 'Desk note for sync round-trip',
					folder: '',
					tags: [],
					created: now,
					modified: now,
					pinned: 0
				},
				{
					id: 'sync-beta-e2e',
					title: 'Sync Beta',
					body: 'Second note [[Sync Alpha]]',
					folder: '',
					tags: [],
					created: now,
					modified: now,
					pinned: 0,
					links: ['Sync Alpha']
				}
			],
			desk: { canvases: [], items: [], dismissed: {} }
		};

		await page.waitForFunction(() => typeof window.__mashImportSync === 'function');
		const result = await page.evaluate(async (raw) => {
			return (await window.__mashImportSync?.(raw)) ?? {
				ok: false,
				message: 'hook missing'
			};
		}, JSON.stringify(bundle));

		expect(result.ok, result.message).toBe(true);
		expect(result.added).toBeGreaterThanOrEqual(2);
		expect(result.message).toMatch(/^Sync:/);

		await page.getByRole('navigation', { name: 'Mash dock' }).getByRole('button', { name: 'Desk' }).click();
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		await expect(peel.getByRole('option').filter({ hasText: 'Sync Alpha' }).first()).toBeVisible({
			timeout: 10_000
		});
		await expect(peel.getByRole('option').filter({ hasText: 'Sync Beta' })).toBeVisible();
	});
});
