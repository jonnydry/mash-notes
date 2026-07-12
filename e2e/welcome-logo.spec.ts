import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('Permanent welcome branding', () => {
	test('shows Scoop on the pinned card, library row, and large editor', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const now = Date.now();
		const bundle = {
			version: 3,
			exportedAt: now,
			notes: [
				{
					id: 'mash-team-welcome-v1',
					title: 'A quick hello from Scoop',
					body: 'Welcome to Mash. Arrange, connect, and mash your ideas.',
					folder: '',
					tags: ['welcome', 'mash-team'],
					created: now,
					modified: now,
					pinned: 1
				}
			],
			desk: { canvases: [], items: [], dismissed: {} },
			tombstones: []
		};

		await page.waitForFunction(() => typeof window.__mashImportSync === 'function');
		const result = await page.evaluate(
			async (raw) => window.__mashImportSync?.(raw),
			JSON.stringify(bundle)
		);
		expect(result?.ok, result?.message).toBe(true);

		await page.getByRole('button', { name: 'Pinned' }).click();
		const card = page.locator('[data-system-welcome="true"]');
		await expect(card).toBeVisible({ timeout: 15_000 });
		await expect(card.getByAltText('Scoop, the Mash mascot')).toBeVisible();

		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		const row = peel.getByRole('option').filter({ hasText: 'A quick hello from Scoop' });
		await expect(row.getByAltText('Scoop, the Mash mascot')).toBeVisible();
		await row.dblclick();

		const stage = page.getByRole('region', { name: 'Note editor stage' });
		await expect(stage.getByAltText('Scoop, the Mash mascot')).toBeVisible();
	});
});
