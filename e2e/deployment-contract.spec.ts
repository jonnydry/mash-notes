import { expect, test } from '@playwright/test';

const SECURITY_HEADERS = {
	'content-security-policy': "frame-ancestors 'none'",
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-resource-policy': 'same-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY'
} as const;

test.describe('Deployment contract', () => {
	test('serves secure headers, deliberate caching, and the SPA fallback', async ({ request }) => {
		const root = await request.get('/');
		expect(root.ok()).toBe(true);
		const rootHeaders = root.headers();
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(rootHeaders[name], name).toBe(value);
		}
		expect(rootHeaders['cache-control']).toBe('public, max-age=0, must-revalidate');

		const html = await root.text();
		const immutableAsset = html.match(/(?:src|href)="(\/_app\/immutable\/[^"]+\.js)"/)?.[1];
		expect(
			immutableAsset,
			'built HTML must reference a fingerprinted JavaScript asset'
		).toBeTruthy();
		const asset = await request.get(immutableAsset!);
		expect(asset.ok()).toBe(true);
		expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

		const serviceWorker = await request.get('/sw.js');
		expect(serviceWorker.ok()).toBe(true);
		expect(serviceWorker.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
		expect(serviceWorker.headers()['service-worker-allowed']).toBe('/');

		const deepLink = await request.get('/release-smoke/deep-link', {
			headers: { Accept: 'text/html' }
		});
		expect(deepLink.ok()).toBe(true);
		expect(await deepLink.text()).toBe(html);
	});

	test('returns unknown browser routes to the Mash canvas', async ({ page }) => {
		await page.goto('/release-smoke/deep-link');

		await expect(page).toHaveURL('/');
		await expect(page.getByRole('application', { name: 'Mash canvas' })).toBeVisible();
	});
});
