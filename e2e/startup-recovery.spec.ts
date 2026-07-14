import { test, expect } from '@playwright/test';

test('blocks unsafe interaction and retries after local storage startup fails', async ({
	page
}) => {
	await page.addInitScript(() => {
		const factory = indexedDB;
		const originalOpen = factory.open.bind(factory);
		let blocked = true;
		Object.defineProperty(factory, 'open', {
			configurable: true,
			value(name: string, version?: number) {
				if (blocked) throw new DOMException('Synthetic storage failure', 'UnknownError');
				return version === undefined ? originalOpen(name) : originalOpen(name, version);
			}
		});
		(
			window as Window & {
				__mashAllowIndexedDb?: () => void;
			}
		).__mashAllowIndexedDb = () => {
			blocked = false;
		};
	});

	await page.goto('/');
	const recovery = page.getByRole('alertdialog', { name: 'Your local workspace didn’t open' });
	await expect(recovery).toBeVisible({ timeout: 15_000 });
	await expect(recovery).toContainText('Retry reopens the same on-device workspace');
	await expect(page.locator('.mash-app-shell')).toHaveAttribute('inert', '');

	await page.evaluate(() => {
		(
			window as Window & {
				__mashAllowIndexedDb?: () => void;
			}
		).__mashAllowIndexedDb?.();
	});
	await recovery.getByRole('button', { name: 'Retry opening workspace' }).click();
	await expect(recovery).toBeHidden({ timeout: 20_000 });

	await page.getByRole('button', { name: 'Desk', exact: true }).click();
	await expect(page.getByRole('complementary', { name: 'Ingredients' })).toContainText(
		"Hi — I'm Scoop",
		{ timeout: 15_000 }
	);
});

test('falls back to the core mascot when a rotating character is unavailable', async ({ page }) => {
	await page.addInitScript(() => {
		Math.random = () => 0;
	});
	await page.route(/\/icons\/Rotating(?:%20| )Icons\//, (route) => route.abort());

	await page.goto('/');
	const mascot = page.getByTestId('empty-canvas-mascot');
	await expect(mascot).toBeVisible({ timeout: 15_000 });
	await expect(mascot).toHaveAttribute('src', '/icons/mash-empty-mascot.png');
	await expect
		.poll(() => mascot.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
});
