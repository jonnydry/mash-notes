import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

test.describe('URL source cards', () => {
	test('pastes a single http URL as a link card', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const canvas = page.getByRole('application', { name: 'Mash canvas' });
		await canvas.click({ position: { x: 400, y: 300 } });

		await page.evaluate(async () => {
			const text = 'https://example.com/path';
			const dt = new DataTransfer();
			dt.setData('text/plain', text);
			document.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData: dt,
					bubbles: true,
					cancelable: true
				})
			);
		});

		await expect(page.getByRole('group', { name: 'example.com' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByText(/Pasted 1 link card/i)).toBeVisible();
	});
});
