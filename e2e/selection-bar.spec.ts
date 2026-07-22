import { expect, test } from '@playwright/test';
import { createNamedNote, selectNotesInPeel, wipeIndexedDb } from './helpers';

test.describe('Selection bar primary verbs', () => {
	test('shows kitchen primaries and parks secondary under More', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Bar Alpha', 'One');
		await createNamedNote(page, 'Bar Beta', 'Two');

		await selectNotesInPeel(page, ['Bar Alpha', 'Bar Beta']);
		await page.getByRole('button', { name: 'Close ingredients' }).click();

		const bar = page.locator('.mash-dock').filter({ hasText: '2 selected' });
		await expect(bar).toBeVisible();
		const barBox = await bar.boundingBox();
		const viewport = page.viewportSize();
		expect(barBox).not.toBeNull();
		expect(viewport).not.toBeNull();
		expect(barBox!.x).toBeGreaterThanOrEqual(0);
		expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(viewport!.width);

		// Primary kitchen verbs stay loud
		await expect(bar.getByTestId('selection-mash')).toBeVisible();
		await expect(bar.getByTestId('operator-kitchen-toggle')).toBeVisible();
		await expect(bar.getByRole('button', { name: 'Pack' })).toBeVisible();
		await expect(bar.getByRole('button', { name: 'Delete selected' })).toBeVisible();

		// Secondary actions live under More — not on the primary row
		await expect(bar.getByRole('button', { name: 'Tag', exact: true })).toHaveCount(0);
		await expect(bar.getByRole('button', { name: 'Folder', exact: true })).toHaveCount(0);
		await expect(bar.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);

		await bar.getByTestId('selection-more-toggle').click();
		const more = page.getByTestId('selection-more-menu');
		await expect(more).toBeVisible();
		await expect(more.getByRole('button', { name: /Tag/ })).toBeVisible();
		await expect(more.getByRole('button', { name: /Folder/ })).toBeVisible();
		await expect(more.getByRole('button', { name: /Copy/ })).toBeVisible();
		await expect(more.getByRole('button', { name: /Download Markdown/ })).toBeVisible();
		await expect(more.getByRole('button', { name: /Export PDF/ })).toBeVisible();
		await expect(more.getByRole('button', { name: /Export Word/ })).toBeVisible();
	});
});
