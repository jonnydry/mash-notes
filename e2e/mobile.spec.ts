import { expect, test } from '@playwright/test';

test.describe('Mobile desktop notice', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('shows the hardhat mascot and keeps the workspace unmounted', async ({ page }) => {
		await page.goto('/');

		const notice = page.getByTestId('mobile-desktop-notice');
		await expect(notice).toBeVisible();
		await expect(
			notice.getByRole('heading', { name: 'Mash is currently optimized for desktop use.' })
		).toBeVisible();
		await expect(notice).toContainText('Open Mash on a laptop or desktop');
		await expect(page.getByTestId('mobile-settings-mascot')).toHaveAttribute(
			'src',
			'/icons/mash-settings-mascot.png'
		);
		await expect(page.locator('.mash-app-shell')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Mash dock' })).toHaveCount(0);
	});

	test('fits the complete notice inside a phone landscape viewport', async ({ page }) => {
		await page.setViewportSize({ width: 844, height: 390 });
		await page.goto('/');

		const notice = page.getByTestId('mobile-desktop-notice');
		await expect(notice).toBeVisible();
		const card = notice.locator('section');
		await expect(card).toBeVisible();
		const box = await card.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(844);
		expect(box!.y + box!.height).toBeLessThanOrEqual(390);
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
					document.documentElement.scrollHeight <= document.documentElement.clientHeight
			)
		).toBe(true);
	});
});
