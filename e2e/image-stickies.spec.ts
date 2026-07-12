import { test, expect } from '@playwright/test';
import { wipeIndexedDb } from './helpers';

/** Minimal 1×1 PNG */
const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('Image visual stickies', () => {
	test('drops a PNG onto the canvas as an image card', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		const canvas = page.getByRole('application', { name: 'Mash canvas' });
		const dataTransfer = await page.evaluateHandle((b64) => {
			const binary = atob(b64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			const transfer = new DataTransfer();
			transfer.items.add(new File([bytes], 'desk-shot.png', { type: 'image/png' }));
			return transfer;
		}, PNG_BASE64);

		await canvas.dispatchEvent('dragover', { dataTransfer });
		await expect(page.getByText('Drop files to import')).toBeVisible();

		await canvas.dispatchEvent('drop', {
			dataTransfer,
			clientX: 520,
			clientY: 360
		});

		await expect(page.getByRole('group', { name: 'desk-shot' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByText(/Added 1 image card/i)).toBeVisible();

		await dataTransfer.dispose();
	});
});
