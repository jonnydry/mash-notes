import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test('keeps one blank-canvas character per visit and rotates it after reload', async ({ page }) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);

	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();

	const mascot = page.getByTestId('empty-canvas-mascot');
	await expect(mascot).toBeVisible();
	await expect(mascot).toHaveAttribute('src', /\/icons\/Rotating%20Icons\//);
	await expect
		.poll(() => mascot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	const firstCharacter = await mascot.getAttribute('src');

	// Normal board interaction can rerender the empty state, but must not reshuffle this visit.
	await page.getByRole('button', { name: 'Snap', exact: true }).click();
	await expect(mascot).toHaveAttribute('src', firstCharacter ?? '');
	await expect(page.getByAltText('Mash')).toHaveAttribute('src', '/icons/mash-logo-sprouts.png');

	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	const nextMascot = page.getByTestId('empty-canvas-mascot');
	await expect(nextMascot).toBeVisible();
	await expect
		.poll(() => nextMascot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await expect(nextMascot).not.toHaveAttribute('src', firstCharacter ?? '');
	await expect(page.getByAltText('Mash')).toHaveAttribute('src', '/icons/mash-logo-sprouts.png');
});
