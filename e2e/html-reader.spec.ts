import { expect, test } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test('opens an HTML document and saves a text excerpt', async ({ page }) => {
	await wipeIndexedDb(page);

	const html = `<!doctype html><html><title>Reader session</title><body><p>Html excerpt for Mash</p></body></html>`;
	await page.getByTestId('html-reader-input').setInputFiles({
		name: 'reader-session.html',
		mimeType: 'text/html',
		buffer: Buffer.from(html, 'utf8')
	});

	const reader = page.getByRole('region', { name: 'HTML document reader' });
	await expect(reader).toBeVisible();
	await expect(reader.getByText('Html excerpt for Mash')).toBeVisible();

	const stage = page.getByTestId('html-reader-stage');
	await stage.evaluate((el) => {
		const selection = window.getSelection();
		const range = document.createRange();
		const textHost = el.querySelector('p') ?? el;
		range.selectNodeContents(textHost);
		selection?.removeAllRanges();
		selection?.addRange(range);
		el.closest('.mash-docx-stage')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	});

	await reader.getByRole('button', { name: 'Save excerpt' }).click();
	await expect(reader.getByText('1 saved from this document', { exact: true })).toBeVisible();

	await reader.getByRole('button', { name: 'Open 1 on canvas' }).click();
	await expect(page.getByRole('group', { name: 'Html excerpt for Mash' })).toBeVisible();
});

test('sanitizes active HTML and never fetches embedded remote resources', async ({ page }) => {
	await wipeIndexedDb(page);
	const remoteRequests: string[] = [];
	page.on('request', (request) => {
		if (request.url().startsWith('https://tracker.invalid/')) remoteRequests.push(request.url());
	});

	const html = `<!doctype html><html><body>
		<p id="safe" style="background:url(https://tracker.invalid/css)">Safe reader text</p>
		<img src="https://tracker.invalid/pixel" alt="Blocked image" onerror="window.__mashPwned=true">
		<script>window.__mashPwned=true</script>
		<svg onload="window.__mashPwned=true"><script>window.__mashPwned=true</script></svg>
		<a href="javascript:window.__mashPwned=true">Unsafe link</a>
	</body></html>`;
	await page.getByTestId('html-reader-input').setInputFiles({
		name: 'hostile.html',
		mimeType: 'text/html',
		buffer: Buffer.from(html, 'utf8')
	});

	const stage = page.getByTestId('html-reader-stage');
	await expect(stage.getByText('Safe reader text')).toBeVisible();
	await expect(stage.locator('script, style, iframe, object, embed, svg, form, img')).toHaveCount(
		0
	);
	await expect(stage.locator('p').filter({ hasText: 'Safe reader text' })).not.toHaveAttribute(
		'style'
	);
	await expect(stage.locator('a').filter({ hasText: 'Unsafe link' })).not.toHaveAttribute('href');
	expect(
		await page.evaluate(() => Boolean((window as Window & { __mashPwned?: boolean }).__mashPwned))
	).toBe(false);
	expect(remoteRequests).toEqual([]);
});
