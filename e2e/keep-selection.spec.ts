import { expect, test } from '@playwright/test';
import { createNamedNote, wipeIndexedDb } from './helpers';

test.describe('Keep selected mid-desk', () => {
	test('promotes a scratch card via the selection bar', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		await createNamedNote(page, 'Keep me please', 'Promote this without Finish.');

		const card = page.getByRole('group', { name: 'Keep me please' });
		await expect(card).toBeVisible();
		await card.click();

		const keepBtn = page.getByTestId('keep-selection');
		await expect(keepBtn).toBeVisible({ timeout: 10_000 });
		// New notes on scratch desks are session-scoped → Keep appears
		await keepBtn.click();

		await expect(page.getByText(/Kept \d+ card/i)).toBeVisible({ timeout: 10_000 });
		await expect(card.getByText('Kept', { exact: true })).toBeVisible({ timeout: 10_000 });
	});
});
