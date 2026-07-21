import { expect, test } from '@playwright/test';
import {
	DEFAULT_EMPTY_CANVAS_MASCOT,
	EMPTY_CANVAS_MASCOT_SEEN_KEY
} from '../src/lib/empty-canvas-mascot';
import { wipeIndexedDb } from './helpers';

test('shows the core potato first, then rotates once per reload without repeats', async ({
	page
}) => {
	test.setTimeout(60_000);
	await wipeIndexedDb(page);

	const closeIngredients = page.getByRole('button', { name: 'Close ingredients' });
	if (await closeIngredients.isVisible().catch(() => false)) await closeIngredients.click();

	const mascot = page.getByTestId('empty-canvas-mascot');
	await expect(mascot).toBeVisible();
	await expect(mascot).toHaveAttribute('src', DEFAULT_EMPTY_CANVAS_MASCOT.src);
	await expect
		.poll(() => mascot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), EMPTY_CANVAS_MASCOT_SEEN_KEY))
		.toBe('1');
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
	await expect(nextMascot).toHaveAttribute('src', /\/icons\/Rotating%20Icons\//);
	await expect
		.poll(() => nextMascot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await expect(nextMascot).not.toHaveAttribute('src', firstCharacter ?? '');
	const secondCharacter = await nextMascot.getAttribute('src');

	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Mash dock' })).toBeVisible({
		timeout: 30_000
	});
	const thirdMascot = page.getByTestId('empty-canvas-mascot');
	await expect(thirdMascot).toBeVisible();
	await expect(thirdMascot).toHaveAttribute('src', /\/icons\/Rotating%20Icons\//);
	await expect
		.poll(() => thirdMascot.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);
	await expect(thirdMascot).not.toHaveAttribute('src', secondCharacter ?? '');
	await expect(page.getByAltText('Mash')).toHaveAttribute('src', '/icons/mash-logo-sprouts.png');
});
