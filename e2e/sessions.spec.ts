import { expect, test } from '@playwright/test';
import { createNamedNote, dismissBlockingDialogs, openDesksPanel, wipeIndexedDb } from './helpers';

test.describe('Scratch desk lifecycle', () => {
	test('clears into recovery, restores, and can be kept', async ({ page }) => {
		test.setTimeout(60_000);
		await wipeIndexedDb(page);

		await openDesksPanel(page);
		const desks = page.getByRole('dialog', { name: 'Your desks' });
		await expect(desks.getByText('Local storage')).toBeVisible();
		await page.getByRole('button', { name: 'New scratch desk' }).click();
		await openDesksPanel(page);
		// Active desk row shows scratch lifecycle (may have several scratch desks listed)
		await expect(desks.getByText(/Scratch · clears in \d+ days/).first()).toBeVisible();
		await desks.getByRole('button', { name: 'Close desk panel' }).click();

		await createNamedNote(page, 'Recoverable session note', 'Temporary working material.');
		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const finish = page.getByRole('dialog', { name: 'Finish this desk' });
		await expect(finish.getByRole('button', { name: /Copy Markdown/ })).toBeVisible();
		const clearNow = finish.getByRole('radio', { name: /Clear now/ });
		await clearNow.focus();
		await clearNow.press('Space');
		await finish.getByRole('button', { name: 'Finish and clear' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Clear desk' }).click();

		await expect(page.getByRole('group', { name: 'Recoverable session note' })).toBeHidden();
		await openDesksPanel(page);
		await expect(desks.getByText('Recently cleared')).toBeVisible();
		await desks.getByRole('button', { name: 'Restore' }).click();
		await expect(page.getByRole('group', { name: 'Recoverable session note' })).toBeVisible();

		await page.getByRole('button', { name: 'Finish', exact: true }).click();
		const keepFinish = page.getByRole('dialog', { name: 'Finish this desk' });
		const keepDesk = keepFinish.getByRole('radio', { name: /Keep entire desk/ });
		await keepDesk.focus();
		await keepDesk.press('Space');
		await keepFinish.getByRole('button', { name: 'Finish', exact: true }).click();
		await dismissBlockingDialogs(page);
		await openDesksPanel(page);
		await expect(desks.getByText('Kept on this device').first()).toBeVisible();
	});
});
