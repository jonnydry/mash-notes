import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('Sync bundle', () => {
	test('import sync bundle restores notes into an empty vault', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const now = Date.now();
		const bundle = {
			version: 3,
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
			desk: { canvases: [], items: [], dismissed: {} },
			tombstones: []
		};

		await page.waitForFunction(() => typeof window.__mashImportSync === 'function');
		const result = await page.evaluate(async (raw) => {
			return (
				(await window.__mashImportSync?.(raw)) ?? {
					ok: false,
					message: 'hook missing'
				}
			);
		}, JSON.stringify(bundle));

		expect(result.ok, result.message).toBe(true);
		expect(result.added).toBeGreaterThanOrEqual(2);
		expect(result.message).toMatch(/^Sync:/);

		await page
			.getByRole('navigation', { name: 'Mash dock' })
			.getByRole('button', { name: 'Desk' })
			.click();
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		await expect(peel.getByRole('option').filter({ hasText: 'Sync Alpha' }).first()).toBeVisible({
			timeout: 10_000
		});
		await expect(peel.getByRole('option').filter({ hasText: 'Sync Beta' })).toBeVisible();
	});

	test('tombstone removes a note on import', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const now = Date.now();
		const seed = {
			version: 3,
			exportedAt: now,
			notes: [
				{
					id: 'keep-e2e',
					title: 'Keep Me',
					body: 'stays',
					folder: '',
					tags: [],
					created: now,
					modified: now,
					pinned: 0
				},
				{
					id: 'drop-e2e',
					title: 'Drop Me',
					body: 'gone soon',
					folder: '',
					tags: [],
					created: now,
					modified: now,
					pinned: 0
				}
			],
			desk: { canvases: [], items: [], dismissed: {} },
			tombstones: []
		};

		await page.waitForFunction(() => typeof window.__mashImportSync === 'function');
		await page.evaluate(async (raw) => window.__mashImportSync?.(raw), JSON.stringify(seed));

		const withTombstone = {
			version: 3,
			exportedAt: now + 1,
			notes: [
				{
					id: 'keep-e2e',
					title: 'Keep Me',
					body: 'stays',
					folder: '',
					tags: [],
					created: now,
					modified: now,
					pinned: 0
				}
			],
			desk: { canvases: [], items: [], dismissed: {} },
			tombstones: [{ id: 'drop-e2e', deletedAt: now + 1 }]
		};

		const result = await page.evaluate(
			async (raw) =>
				(await window.__mashImportSync?.(raw)) ?? { ok: false, message: 'hook missing' },
			JSON.stringify(withTombstone)
		);
		expect(result.ok, result.message).toBe(true);
		expect(result.message).toMatch(/removed/);

		await page
			.getByRole('navigation', { name: 'Mash dock' })
			.getByRole('button', { name: 'Desk' })
			.click();
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		await expect(peel.getByRole('option').filter({ hasText: 'Keep Me' })).toBeVisible({
			timeout: 10_000
		});
		await expect(peel.getByRole('option').filter({ hasText: 'Drop Me' })).toHaveCount(0);
	});

	test('body conflict opens Conflicts peel and restore works', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const t0 = Date.now();
		const localSeed = {
			version: 3,
			exportedAt: t0,
			notes: [
				{
					id: 'conflict-e2e',
					title: 'Conflict Note',
					body: 'local body',
					folder: '',
					tags: [],
					created: t0,
					modified: t0,
					pinned: 0
				}
			],
			desk: { canvases: [], items: [], dismissed: {} },
			tombstones: []
		};

		await page.waitForFunction(() => typeof window.__mashImportSync === 'function');
		await page.evaluate(async (raw) => window.__mashImportSync?.(raw), JSON.stringify(localSeed));

		const remoteNewer = {
			version: 3,
			exportedAt: t0 + 10,
			notes: [
				{
					id: 'conflict-e2e',
					title: 'Conflict Note',
					body: 'remote body',
					folder: '',
					tags: [],
					created: t0,
					modified: t0 + 5,
					pinned: 0
				}
			],
			desk: { canvases: [], items: [], dismissed: {} },
			tombstones: []
		};

		const result = await page.evaluate(
			async (raw) =>
				(await window.__mashImportSync?.(raw)) ?? { ok: false, message: 'hook missing' },
			JSON.stringify(remoteNewer)
		);
		expect(result.ok, result.message).toBe(true);

		const conflictsPeel = page.getByTestId('sync-conflicts-peel');
		await expect(conflictsPeel).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId('sync-conflict-row').first()).toBeVisible();
		await page.getByTestId('sync-conflict-restore').first().click();
		await expect(page.getByTestId('sync-conflict-row')).toHaveCount(0);

		await page
			.getByRole('navigation', { name: 'Mash dock' })
			.getByRole('button', { name: 'Desk' })
			.click();
		const peel = page.getByRole('complementary', { name: 'Note scanner' });
		const row = peel.getByRole('option').filter({ hasText: 'Conflict Note' });
		await row.dblclick();
		await expect(page.locator('textarea.mash-sticky-body').first()).toHaveValue('local body', {
			timeout: 10_000
		});
	});
});
